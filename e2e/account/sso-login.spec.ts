import { expect, test, type Page } from '@playwright/test';
import { readSessionStore } from '../helpers/accounts';
import { chooseFromAccountMenu, expectAccountRailCount } from '../helpers/auth';
import { defined } from '../../src/test/utils/defined';
import {
  PROVIDER,
  listSlotHomeserver,
  loginPath,
  mintLoginToken,
  postJson,
  stubIdentityProvider,
  waitForShell,
} from '../helpers/ssoHomeserver';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Single sign-on on the deployment's own homeserver (helpers in `ssoHomeserver.ts`). Every test
// lists the slot's server in `config.json`, as a deployment lists its own, so its buttons start
// at once; `sso-unlisted-server.spec.ts` covers servers the deployment does not offer.

const expectActiveUser = async (page: Page, username: string) => {
  await expect
    .poll(async () => {
      const store = await readSessionStore(page);
      return store.sessions.find((session) => session.sessionId === store.activeSessionId)?.userId;
    })
    .toMatch(new RegExp(`^@${username}:`));
};

// A server that a crafted link names: it answers discovery and the login flows like a homeserver
// and records every request, so a test can tell whether a login token ever reached it.
const OTHER_SERVER = 'https://other-server.example';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

/** The login requests that reached the other server, where a login token would go. */
const loginPosts = (requests: string[]) =>
  requests.filter((request) => request === 'POST /_matrix/client/v3/login');

const stubOtherServer = async (page: Page): Promise<string[]> => {
  const requests: string[] = [];
  await page.route(`${OTHER_SERVER}/**`, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    requests.push(`${request.method()} ${pathname}`);
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
    } else if (pathname === '/.well-known/matrix/client') {
      await route.fulfill({ headers: CORS, json: { 'm.homeserver': { base_url: OTHER_SERVER } } });
    } else if (pathname === '/_matrix/client/versions') {
      await route.fulfill({ headers: CORS, json: { versions: ['v1.11'] } });
    } else if (pathname === '/_matrix/client/v3/login' && request.method() === 'GET') {
      await route.fulfill({
        headers: CORS,
        json: { flows: [{ type: 'm.login.token' }, { type: 'm.login.password' }] },
      });
    } else {
      await route.fulfill({
        status: 403,
        headers: CORS,
        json: { errcode: 'M_FORBIDDEN', error: 'Recorded by the e2e stub' },
      });
    }
  });
  return requests;
};

test.beforeEach(async ({ page }) => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  await listSlotHomeserver(page);
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

  await chooseFromAccountMenu(page, 'Add Account');
  await expect(page).toHaveURL(/addAccount=1/);
  await page.getByRole('link', { name: `Continue with ${PROVIDER.name}` }).click();

  await waitForShell(page);
  await expectActiveUser(page, second);
  // The return address kept the add-account flow, so the first account stayed signed in.
  expect(
    new URL(defined(stub.redirectUrls[1], 'the second SSO redirect')).searchParams.get('addAccount')
  ).toBe('1');
  await expectAccountRailCount(page, 3);
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

test('never uses a login token from a link that no sign-in in this tab started', async ({
  page,
}) => {
  test.slow();
  const username = `sso_link_${Date.now().toString(36)}`;
  const token = await mintLoginToken(username);
  const otherServerRequests = await stubOtherServer(page);

  // A link naming another server (it would receive the token), and one naming the real server
  // with the attacker's own token (the victim would end up in the attacker's account).
  const crafted = [
    `/login/${encodeURIComponent(OTHER_SERVER)}/?addAccount=1&loginToken=${token}`,
    loginPath(`?addAccount=1&loginToken=${token}`),
  ];
  for (const link of crafted) {
    // eslint-disable-next-line no-await-in-loop
    await page.goto(link);
    // eslint-disable-next-line no-await-in-loop
    await expect(page.getByRole('alert')).toContainText('This sign-in was not started here', {
      timeout: 30_000,
    });
    // eslint-disable-next-line no-await-in-loop
    await expect(page).not.toHaveURL(/loginToken=/);
  }

  expect(loginPosts(otherServerRequests)).toEqual([]);
  expect((await readSessionStore(page)).sessions).toHaveLength(0);
  // The token was never spent: it still signs in.
  const redeemed = await postJson('/v3/login', { type: 'm.login.token', token });
  expect(redeemed.status, 'the unused token still signs in').toBe(200);
});

test('exchanges a returning token at the server the sign-in went to, not one the address names', async ({
  page,
}) => {
  test.slow();
  const username = `sso_ret_${Date.now().toString(36)}`;
  const token = await mintLoginToken(username);
  const otherServerRequests = await stubOtherServer(page);
  // The return address names another server but carries this sign-in's nonce.
  await stubIdentityProvider(
    page,
    () => token,
    (back) => {
      back.pathname = `/login/${encodeURIComponent(OTHER_SERVER)}/`;
    }
  );

  await page.goto(loginPath());
  await page.getByRole('link', { name: `Continue with ${PROVIDER.name}` }).click();

  await waitForShell(page);
  await expectActiveUser(page, username);
  const store = await readSessionStore(page);
  expect(store.sessions.map((session) => session.baseUrl)).toEqual([HOMESERVER]);
  expect(loginPosts(otherServerRequests)).toEqual([]);
});
