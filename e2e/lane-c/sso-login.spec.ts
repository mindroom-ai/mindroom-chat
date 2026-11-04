import { expect, test, type Page } from '@playwright/test';
import { readSessionStore } from '../helpers/accounts';
import {
  accountRailButtonSelector,
  activeAccountButtonNamePattern,
  waitForLoggedInShell,
} from '../helpers/auth';
import { defined } from '../../src/app/test-utils/defined';

// Single sign-on against the disposable homeserver of `just hs-up`. The test homeserver has no
// identity provider, so two requests are answered here: the login flows gain an `m.login.sso`
// flow, and the SSO redirect stands in for the provider by sending the browser straight back
// with a login token. That token is a real one, minted by the homeserver for a real account
// (`POST /login/get_token`), so the client's token exchange and the session it starts are real.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'sso-spec-password';
const PROVIDER = { id: 'oidc-e2e', name: 'E2E Identity' };

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const postJson = async (path: string, body: unknown, accessToken?: string) => {
  const response = await fetch(`${HOMESERVER}/_matrix/client${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

/** Registers an account and returns a fresh login token for it, as an SSO callback would. */
const mintLoginToken = async (username: string): Promise<string> => {
  const registered = await postJson('/v3/register', {
    username,
    password: PASSWORD,
    auth: { type: 'm.login.dummy' },
  });
  expect(registered.status, `registering ${username}`).toBe(200);
  const identifier = { type: 'm.id.user', user: username };
  // The homeserver asks for the password again before it hands out a login token.
  const minted = await postJson(
    '/v1/login/get_token',
    { auth: { type: 'm.login.password', identifier, password: PASSWORD } },
    registered.body.access_token as string
  );
  expect(minted.status, 'minting a login token').toBe(200);
  return minted.body.login_token as string;
};

type SsoStub = { redirectUrls: string[] };

/**
 * Advertises one identity provider and answers its redirect by returning to the client's
 * `redirectUrl` with `loginToken`, the way the homeserver does after the provider signs in.
 */
const stubIdentityProvider = async (
  page: Page,
  loginToken: () => string | Promise<string>
): Promise<SsoStub> => {
  const stub: SsoStub = { redirectUrls: [] };
  await page.route(`${HOMESERVER}/_matrix/client/v3/login`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      json: {
        flows: [
          { type: 'm.login.sso', identity_providers: [PROVIDER] },
          { type: 'm.login.token' },
          { type: 'm.login.password' },
        ],
      },
    });
  });
  await page.route(
    `${HOMESERVER}/_matrix/client/v3/login/sso/redirect/${PROVIDER.id}?*`,
    async (route) => {
      const redirectUrl = new URL(route.request().url()).searchParams.get('redirectUrl') ?? '';
      stub.redirectUrls.push(redirectUrl);
      const back = new URL(redirectUrl);
      back.searchParams.set('loginToken', await loginToken());
      await route.fulfill({ status: 302, headers: { location: back.href } });
    }
  );
  return stub;
};

/** The signed-in shell; a first sync on a busy machine can outlast the shared helper's wait. */
const waitForShell = async (page: Page) => {
  await expect(page.getByRole('button', { name: activeAccountButtonNamePattern })).toBeVisible({
    timeout: 90_000,
  });
  await waitForLoggedInShell(page);
};

const loginPath = (search = '') => `/login/${encodeURIComponent(HOMESERVER)}${search}`;

const expectActiveUser = async (page: Page, username: string) => {
  await expect
    .poll(async () => {
      const store = await readSessionStore(page);
      return store.sessions.find((session) => session.sessionId === store.activeSessionId)?.userId;
    })
    .toMatch(new RegExp(`^@${username}:`));
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

test('signs in through an identity provider and returns with a login token', async ({ page }) => {
  test.slow();
  const username = `sso_${Date.now().toString(36)}`;
  const token = await mintLoginToken(username);
  const stub = await stubIdentityProvider(page, () => token);

  await page.goto(loginPath());
  const providerButton = page.getByRole('link', { name: `Continue with ${PROVIDER.name}` });
  await expect(providerButton).toBeVisible({ timeout: 30_000 });
  // Password sign-in stays offered beside single sign-on.
  await expect(page.locator('input[name="passwordInput"]')).toBeVisible();
  await providerButton.click();

  await waitForShell(page);
  await expectActiveUser(page, username);
  // The provider was asked to come back to this server's login page, and the token is gone.
  expect(stub.redirectUrls).toHaveLength(1);
  expect(new URL(defined(stub.redirectUrls[0], 'the first SSO redirect')).pathname).toBe(
    loginPath()
  );
  expect(new URL(page.url()).searchParams.has('loginToken')).toBe(false);

  // The session survives a reload like a password session does.
  await page.reload();
  await waitForShell(page);
  await expectActiveUser(page, username);
});

test('adds a second account through single sign-on', async ({ page }) => {
  test.slow();
  const first = `sso_a_${Date.now().toString(36)}`;
  const second = `sso_b_${Date.now().toString(36)}`;
  // Minted when the provider returns, since a login token lives only two minutes.
  const stub = await stubIdentityProvider(page, () =>
    mintLoginToken(stub.redirectUrls.length === 1 ? first : second)
  );

  await page.goto(loginPath());
  await page.getByRole('link', { name: `Continue with ${PROVIDER.name}` }).click();
  await waitForShell(page);
  await expectActiveUser(page, first);

  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page).toHaveURL(/addAccount=1/);
  await page.getByRole('link', { name: `Continue with ${PROVIDER.name}` }).click();

  await waitForShell(page);
  await expectActiveUser(page, second);
  // The return address kept the add-account flow, so the first account stayed signed in.
  expect(
    new URL(defined(stub.redirectUrls[1], 'the second SSO redirect')).searchParams.get('addAccount')
  ).toBe('1');
  await expect(page.locator(accountRailButtonSelector)).toHaveCount(3);
});

test('explains a login token the homeserver rejects', async ({ page }) => {
  await stubIdentityProvider(page, () => 'not-a-real-login-token');

  await page.goto(loginPath());
  await page.getByRole('link', { name: `Continue with ${PROVIDER.name}` }).click();

  await expect(page.getByRole('alert')).toContainText('Invalid login token.', { timeout: 30_000 });
  const store = await readSessionStore(page);
  expect(store.sessions).toHaveLength(0);
  // The rejected token leaves the address, and signing in again is one click away.
  await expect(page).not.toHaveURL(/loginToken=/);
  await expect(page.getByRole('link', { name: `Continue with ${PROVIDER.name}` })).toBeVisible();
  await expect(page.locator('input[name="passwordInput"]')).toBeVisible();
});
