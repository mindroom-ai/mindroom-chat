import { expect, test, type Page } from '@playwright/test';
import { readSessionStore } from '../helpers/accounts';
import {
  activeAccountButtonNamePattern,
  chooseFromAccountMenu,
  waitForLoggedInShell,
} from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The signed-out screens against the disposable homeserver of `just hs-up`: the server field and
// well-known discovery, a full Matrix ID that names another server, the way back from adding an
// account, and password reset. Names under `.test` never resolve, so their well-known answers and
// their homeserver API are answered here.
const PASSWORD = 'auth-shell-spec-password';

const registerUser = async (username: string): Promise<void> => {
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
};

/** Answers `https://<name>/.well-known/matrix/client` with `baseUrl`. */
const serveWellKnown = (page: Page, name: string, baseUrl: string) =>
  page.route(`https://${name}/.well-known/matrix/client`, (route) =>
    route.fulfill({ json: { 'm.homeserver': { base_url: baseUrl } } })
  );

/** The signed-in shell; a first sync on a busy machine can outlast the shared helper's wait. */
const waitForShell = async (page: Page) => {
  await expect(page.getByRole('button', { name: activeAccountButtonNamePattern })).toBeVisible({
    timeout: 90_000,
  });
  await waitForLoggedInShell(page);
};

const activeSession = async (page: Page) => {
  const store = await readSessionStore(page);
  return store.sessions.find((session) => session.sessionId === store.activeSessionId);
};

const useServer = async (page: Page, server: string) => {
  const serverInput = page.locator('input[name="serverInput"]');
  await serverInput.fill(server);
  await serverInput.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/login/${encodeURIComponent(server)}`));
};

const signIn = async (page: Page, user: string) => {
  await page.locator('input[name="usernameInput"]').fill(user);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

test('names the server in the address and explains servers it cannot use', async ({ page }) => {
  await page.goto('/login');
  // A bare /login names the default server, so the address always says where sign-in goes.
  await expect(page).toHaveURL(/\/login\/[^/?]+/, { timeout: 30_000 });

  await useServer(page, 'http://matrix.example.org');
  await expect(page.getByRole('alert')).toContainText('Only HTTPS servers are allowed.');

  let unreachable = true;
  await page.route('https://flaky.test/.well-known/matrix/client', (route) =>
    unreachable
      ? route.abort('connectionrefused')
      : route.fulfill({ json: { 'm.homeserver': { base_url: HOMESERVER } } })
  );
  await useServer(page, 'flaky.test');
  await expect(page.getByRole('alert')).toContainText('Either server is unavailable');
  unreachable = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('input[name="usernameInput"]')).toBeVisible();
});

test('finds the homeserver of a server name through its well-known answer', async ({ page }) => {
  test.slow();
  const username = `shell_wk_${Date.now().toString(36)}`;
  await registerUser(username);
  await serveWellKnown(page, 'chat.example.test', HOMESERVER);

  await page.goto(`/login/${encodeURIComponent('chat.example.test')}`);
  await signIn(page, username);
  await waitForShell(page);
  // The session keeps the homeserver URL the well-known answer named, not the server name.
  expect((await activeSession(page))?.baseUrl).toBe(HOMESERVER);
});

test('signs a full Matrix ID in at the homeserver its server names', async ({ page }) => {
  test.slow();
  const username = `shell_mxid_${Date.now().toString(36)}`;
  await registerUser(username);
  // The picked server offers password login but must never see these credentials.
  const decoyLogins: string[] = [];
  await serveWellKnown(page, 'decoy.test', 'https://decoy.test');
  await page.route('https://decoy.test/_matrix/client/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/login') && route.request().method() === 'POST') {
      decoyLogins.push(route.request().postData() ?? '');
      await route.fulfill({ status: 403, json: { errcode: 'M_FORBIDDEN', error: 'decoy' } });
    } else if (pathname.endsWith('/login')) {
      await route.fulfill({ json: { flows: [{ type: 'm.login.password' }] } });
    } else if (pathname.endsWith('/versions')) {
      await route.fulfill({ json: { versions: ['v1.11'] } });
    } else {
      await route.fulfill({ status: 403, json: { errcode: 'M_FORBIDDEN', error: 'decoy' } });
    }
  });
  await serveWellKnown(page, 'people.test', HOMESERVER);

  const homeserverLogins: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url() === `${HOMESERVER}/_matrix/client/v3/login`) {
      homeserverLogins.push(request.postData() ?? '');
    }
  });

  await page.goto(`/login/${encodeURIComponent('decoy.test')}`);
  await signIn(page, `@${username}:people.test`);
  // The homeserver knows the account by its own server name, so it refuses this login; what
  // matters is that the credentials went there and not to the picked server.
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 30_000 });
  expect(decoyLogins).toEqual([]);
  expect(homeserverLogins).toHaveLength(1);
  expect(homeserverLogins[0]).toContain(`@${username}:people.test`);

  // A server name that cannot be looked up keeps the login at the picked server.
  await page.goto(`/login/${encodeURIComponent(HOMESERVER)}`);
  await signIn(page, `@${username}:matrix.localhost`);
  await waitForShell(page);
  expect((await activeSession(page))?.userId).toBe(`@${username}:matrix.localhost`);
});

test('leaves an abandoned add-account flow for the current account', async ({ page }) => {
  test.slow();
  const username = `shell_back_${Date.now().toString(36)}`;
  await registerUser(username);
  await page.goto(`/login/${encodeURIComponent(HOMESERVER)}`);
  await signIn(page, username);
  await waitForShell(page);
  await page.goto('/home/create/');
  await expect(page).toHaveURL(/\/home\/create\/?$/);

  await chooseFromAccountMenu(page, 'Add Account');
  await expect(page).toHaveURL(/addAccount=1/);
  await page.getByRole('link', { name: 'Back to current account' }).click();
  await expect(page).toHaveURL(/\/home\/create\/?$/);
  await waitForShell(page);
});

test('resets a password through the email the server sends', async ({ page }) => {
  const requests: string[] = [];
  await page.route(`${HOMESERVER}/_matrix/client/v3/account/password**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    requests.push(pathname.replace('/_matrix/client/v3', ''));
    if (pathname.endsWith('/email/requestToken')) {
      await route.fulfill({ json: { sid: 'reset-sid' } });
      return;
    }
    const body = route.request().postDataJSON() as {
      new_password?: string;
      auth?: { threepid_creds?: { sid?: string } };
    };
    expect(body.new_password).toBe('a-new-password');
    expect(body.auth?.threepid_creds?.sid).toBe('reset-sid');
    await route.fulfill({ json: {} });
  });

  await page.goto(`/reset-password/${encodeURIComponent(HOMESERVER)}?addAccount=1`);
  await page.locator('input[name="emailInput"]').fill('someone@example.org');
  await page.locator('input[name="passwordInput"]').fill('a-new-password');
  await page.locator('input[name="confirmPasswordInput"]').fill('a-new-password');
  await page.getByRole('button', { name: 'Reset Password' }).click();
  await expect(page.getByText('Please check your email "someone@example.org"')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Continue' }).click();
  // The operator notice stack above every screen is a status region as well, empty here.
  await expect(
    page.getByRole('status').filter({ hasText: 'Password has been reset successfully.' })
  ).toBeVisible();
  expect(requests).toEqual(['/account/password/email/requestToken', '/account/password']);

  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/login/${encodeURIComponent(HOMESERVER)}/?\\?addAccount=1`)
  );
});
