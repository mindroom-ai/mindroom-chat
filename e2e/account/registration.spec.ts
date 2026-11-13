import { expect, test, type Page, type Route } from '@playwright/test';
import { readSessionStore } from '../helpers/accounts';
import { activeAccountButtonNamePattern, waitForLoggedInShell } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Sign-up against the disposable homeserver of `just hs-up`, which has open registration
// (one `m.login.dummy` stage). The token test puts a registration token and terms stage in
// front of it: those two stages are answered here, and the last request goes on to the real
// server with the dummy stage, so the account and its session are real.
const PASSWORD = 'registration-spec-password';
const TOKEN_STAGE = 'm.login.registration_token';
const TERMS_STAGE = 'm.login.terms';
const GOOD_TOKEN = 'mindroom-invite';
const TERMS_URL = 'https://example.org/terms-of-service';

const registerPath = (search = '') => `/register/${encodeURIComponent(HOMESERVER)}${search}`;

/** The signed-in shell; a first sync on a busy machine can outlast the shared helper's wait. */
const waitForShell = async (page: Page) => {
  await expect(page.getByRole('button', { name: activeAccountButtonNamePattern })).toBeVisible({
    timeout: 90_000,
  });
  await waitForLoggedInShell(page);
};

const expectActiveUser = async (page: Page, username: string) => {
  await expect
    .poll(async () => {
      const store = await readSessionStore(page);
      return store.sessions.find((session) => session.sessionId === store.activeSessionId)?.userId;
    })
    .toMatch(new RegExp(`^@${username}:`));
};

const fillAccount = async (page: Page, username: string) => {
  await page.locator('input[name="usernameInput"]').fill(username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.locator('input[name="confirmPasswordInput"]').fill(PASSWORD);
};

type TokenGate = { tokensTried: string[] };

/** Answers the registration token and terms stages, then hands the sign-up to the server. */
const gateRegistration = async (page: Page): Promise<TokenGate> => {
  const gate: TokenGate = { tokensTried: [] };
  const session = 'registration-spec-session';
  let tokenAccepted = false;
  const challenge = (route: Route, completed: string[], error?: string) =>
    route.fulfill({
      status: 401,
      json: {
        session,
        completed,
        flows: [{ stages: [TOKEN_STAGE, TERMS_STAGE] }],
        params: {
          [TERMS_STAGE]: {
            policies: { terms: { version: '1', en: { name: 'Terms', url: TERMS_URL } } },
          },
        },
        ...(error ? { errcode: 'M_FORBIDDEN', error } : {}),
      },
    });

  await page.route(
    (url) =>
      url.href.startsWith(`${HOMESERVER}/_matrix/client/v3/register`) &&
      url.pathname.endsWith('/register'),
    async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      const body = (route.request().postDataJSON() ?? {}) as {
        auth?: { type?: string; token?: string; session?: string };
      };
      const { auth } = body;
      if (!auth) {
        await challenge(route, tokenAccepted ? [TOKEN_STAGE] : []);
        return;
      }
      expect(auth.session).toBe(session);
      if (auth.type === TOKEN_STAGE) {
        gate.tokensTried.push(auth.token ?? '');
        tokenAccepted = auth.token === GOOD_TOKEN;
        await challenge(
          route,
          tokenAccepted ? [TOKEN_STAGE] : [],
          tokenAccepted ? undefined : 'Invalid registration token'
        );
        return;
      }
      if (auth.type === TERMS_STAGE && tokenAccepted) {
        const response = await route.fetch({
          postData: JSON.stringify({ ...body, auth: { type: 'm.login.dummy' } }),
        });
        await route.fulfill({ response });
        return;
      }
      await challenge(route, [], 'Unexpected stage');
    }
  );
  return gate;
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

test('creates an account with a password and keeps it after a reload', async ({ page }) => {
  test.slow();
  const username = `signup_${Date.now().toString(36)}`;

  await page.goto(registerPath());
  await expect(page.locator('input[name="usernameInput"]')).toBeVisible({ timeout: 30_000 });
  // An open server asks for no token, email or terms.
  await expect(page.locator('input[name="tokenInput"]')).toHaveCount(0);
  await fillAccount(page, username);
  await page.getByRole('button', { name: 'Register' }).click();

  await waitForShell(page);
  await expectActiveUser(page, username);
  await page.reload();
  await waitForShell(page);
  await expectActiveUser(page, username);
});

test('tells a taken username apart and keeps the form', async ({ page }) => {
  const username = `signup_taken_${Date.now().toString(36)}`;
  const created = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(created.ok).toBe(true);

  await page.goto(registerPath());
  await fillAccount(page, username);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByRole('alert')).toContainText('This username is already taken.', {
    timeout: 30_000,
  });
  await expect(page.locator('input[name="usernameInput"]')).toHaveValue(username);
});

test('asks for the registration token and the terms the server requires', async ({ page }) => {
  test.slow();
  const gate = await gateRegistration(page);
  const username = `signup_token_${Date.now().toString(36)}`;

  await page.goto(registerPath());
  const tokenInput = page.locator('input[name="tokenInput"]');
  await expect(tokenInput).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Registration Token', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Terms and Conditions' })).toHaveAttribute(
    'href',
    TERMS_URL
  );

  await fillAccount(page, username);
  await tokenInput.fill('wrong-token');
  await page.locator('input[name="termsInput"]').check();
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid registration token provided.', {
    timeout: 30_000,
  });

  await tokenInput.fill(GOOD_TOKEN);
  await page.getByRole('button', { name: 'Register' }).click();
  await waitForShell(page);
  await expectActiveUser(page, username);
  expect(gate.tokensTried).toEqual(['wrong-token', GOOD_TOKEN]);
});

test('fills the registration token from an invite link', async ({ page }) => {
  await gateRegistration(page);
  await page.goto(registerPath(`?token=${GOOD_TOKEN}`));
  await expect(page.locator('input[name="tokenInput"]')).toHaveValue(GOOD_TOKEN, {
    timeout: 30_000,
  });
});
