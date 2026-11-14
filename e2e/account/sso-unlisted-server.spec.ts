import { expect, test, type Page } from '@playwright/test';
import { readSessionStore } from '../helpers/accounts';
import {
  PASSWORD,
  PROVIDER,
  listSlotHomeserver,
  loginPath,
  registerSsoAccount,
  stubIdentityProvider,
  waitForShell,
} from '../helpers/ssoHomeserver';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// A server the deployment does not offer may be an attacker's (R6, B1): the sign-in page for it
// runs on the real Chat origin, its SSO redirect reads the nonce this tab put in `redirectUrl`,
// and it sends the browser on to the person's real homeserver with that nonce. The real server
// returns the real login token, and the client exchanges it at the server the sign-in started
// on: the attacker's. So a sign-in button for such a server first names it and asks.
//
// Here the attacker's server is a route on https://evil-hs.example, and the person's real
// homeserver is the slot's, whose generic SSO redirect stands in for the identity provider: it
// returns to its `redirectUrl` with a real login token minted for the person.

const EVIL_HOST = 'evil-hs.example';
const EVIL = `https://${EVIL_HOST}`;
const SSO_ATTEMPTS_KEY = 'mindroom_sso_attempts';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

type Attack = {
  /** Every request that reached the attacker's server. */
  evilRequests: string[];
  /** The nonce the attacker read from the redirect this tab sent it. */
  nonceSeenByEvil?: string;
  /** The login token the client handed the attacker's server. */
  tokenReceivedByEvil?: string;
  /** Return addresses the real homeserver's SSO was asked to come back to. */
  realSsoReturns: string[];
};

const stubAttack = async (page: Page, mintVictimToken: () => Promise<string>): Promise<Attack> => {
  const attack: Attack = { evilRequests: [], realSsoReturns: [] };
  // No real network for the default servers of the shipped config.
  await page.route(/https:\/\/(mindroom\.chat|matrix\.org|[^/]*\.matrix\.org)\//, (route) =>
    route.abort()
  );
  await page.route(`${HOMESERVER}/_matrix/client/v3/login/sso/redirect?*`, async (route) => {
    const redirectUrl = new URL(route.request().url()).searchParams.get('redirectUrl') ?? '';
    attack.realSsoReturns.push(redirectUrl);
    const back = new URL(redirectUrl);
    back.searchParams.set('loginToken', await mintVictimToken());
    await route.fulfill({ status: 302, headers: { location: back.href } });
  });
  await page.route(`${EVIL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    attack.evilRequests.push(`${request.method()} ${url.pathname}`);
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
    } else if (url.pathname === '/.well-known/matrix/client') {
      await route.fulfill({ headers: CORS, json: { 'm.homeserver': { base_url: EVIL } } });
    } else if (url.pathname === '/_matrix/client/versions') {
      await route.fulfill({ headers: CORS, json: { versions: ['v1.11', 'v1.12'] } });
    } else if (url.pathname === '/_matrix/client/v3/login' && request.method() === 'GET') {
      await route.fulfill({
        headers: CORS,
        json: {
          flows: [
            { type: 'm.login.sso', identity_providers: [{ id: 'google', name: 'Google' }] },
            { type: 'm.login.token' },
          ],
        },
      });
    } else if (url.pathname === '/_matrix/client/v3/register') {
      // Open sign-up, so the registration page offers the same buttons.
      await route.fulfill({
        status: 401,
        headers: CORS,
        json: { session: 'evil', flows: [{ stages: ['m.login.dummy'] }], params: {} },
      });
    } else if (url.pathname.startsWith('/_matrix/client/v3/login/sso/redirect')) {
      // The nonce this tab noted for the attacker travels on, now to the real homeserver, with a
      // return address that names the real server so nothing on screen mentions evil afterwards.
      const back = new URL(url.searchParams.get('redirectUrl') ?? '');
      attack.nonceSeenByEvil = back.searchParams.get('ssoNonce') ?? undefined;
      back.pathname = `/login/${encodeURIComponent(HOMESERVER)}/`;
      const next = `${HOMESERVER}/_matrix/client/v3/login/sso/redirect?redirectUrl=${encodeURIComponent(
        back.href
      )}`;
      // A page redirect: Playwright does not route the target of a fulfilled 302 to another origin.
      await route.fulfill({
        headers: { 'content-type': 'text/html' },
        body: `<!doctype html><script>location.replace(${JSON.stringify(next)})</script>`,
      });
    } else if (url.pathname === '/_matrix/client/v3/login' && request.method() === 'POST') {
      attack.tokenReceivedByEvil = (
        JSON.parse(request.postData() ?? '{}') as { token?: string }
      ).token;
      await route.fulfill({
        status: 403,
        headers: CORS,
        json: { errcode: 'M_FORBIDDEN', error: 'Invalid login token' },
      });
    } else {
      await route.fulfill({ status: 404, headers: CORS, json: { errcode: 'M_UNRECOGNIZED' } });
    }
  });
  return attack;
};

const prompt = (page: Page) => page.getByRole('alertdialog', { name: 'Check the server first' });

/** The attacker never learned a nonce, never got a token, and this tab noted no sign-in. */
const expectNothingSent = async (page: Page, attack: Attack) => {
  expect(attack.evilRequests.filter((line) => line.includes('/login/sso/redirect'))).toEqual([]);
  expect(attack.nonceSeenByEvil).toBeUndefined();
  expect(attack.tokenReceivedByEvil).toBeUndefined();
  expect(attack.realSsoReturns).toEqual([]);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SSO_ATTEMPTS_KEY)).toBeNull();
};

const pressGoogleOnEvil = async (page: Page, path: string) => {
  await page.goto(path);
  const button = page.getByRole('link', { name: 'Continue with Google' });
  await expect(button).toBeVisible({ timeout: 60_000 });
  await button.click();
  await expect(prompt(page)).toBeVisible();
  await expect(prompt(page).locator('#unlisted-server-host')).toHaveText(EVIL_HOST);
  await expect(prompt(page)).toContainText(`Only continue if you trust ${EVIL_HOST}.`);
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

test('asks before single sign-on on a server the deployment does not offer, and Cancel sends it nothing', async ({
  page,
}) => {
  const mint = await registerSsoAccount(`victim_${Date.now().toString(36)}`);
  const attack = await stubAttack(page, mint);

  await pressGoogleOnEvil(page, `/login/${EVIL_HOST}/`);
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(prompt(page)).toBeHidden();
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await expectNothingSent(page, attack);
  expect((await readSessionStore(page)).sessions).toHaveLength(0);
});

test('Escape refuses too, and the registration page asks the same way', async ({ page }) => {
  const mint = await registerSsoAccount(`victim_${Date.now().toString(36)}`);
  const attack = await stubAttack(page, mint);

  await pressGoogleOnEvil(page, `/register/${EVIL_HOST}/`);
  await page.keyboard.press('Escape');

  await expect(prompt(page)).toBeHidden();
  await expectNothingSent(page, attack);
});

test('a signed-in person opening an add-account link for the server is asked too', async ({
  page,
}) => {
  test.slow();
  const username = `victim_${Date.now().toString(36)}`;
  const mint = await registerSsoAccount(username);
  const attack = await stubAttack(page, mint);
  await page.goto(loginPath());
  await page.locator('input[name="usernameInput"]').fill(username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.locator('input[name="passwordInput"]').press('Enter');
  await waitForShell(page);

  await pressGoogleOnEvil(page, `/login/${EVIL_HOST}/?addAccount=1`);
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(prompt(page)).toBeHidden();
  await expectNothingSent(page, attack);
  expect((await readSessionStore(page)).sessions).toHaveLength(1);
});

test('only a yes lets the sign-in go to that server, which then receives the login', async ({
  page,
}) => {
  test.slow();
  const mint = await registerSsoAccount(`victim_${Date.now().toString(36)}`);
  const attack = await stubAttack(page, mint);

  await pressGoogleOnEvil(page, `/login/${EVIL_HOST}/`);
  // Before the answer, nothing has left the page.
  expect(attack.nonceSeenByEvil).toBeUndefined();
  await page.getByRole('button', { name: 'Continue' }).click();

  // The person trusted the server, so it got what a sign-in there sends it: this is the step the
  // confirmation warns about.
  await expect.poll(() => attack.tokenReceivedByEvil, { timeout: 60_000 }).toBeTruthy();
  expect(attack.nonceSeenByEvil).toMatch(/^[0-9a-f]{32}$/);
  expect(attack.realSsoReturns).toHaveLength(1);
});

test('a server the deployment lists starts single sign-on at once', async ({ page }) => {
  test.slow();
  await listSlotHomeserver(page);
  const username = `listed_${Date.now().toString(36)}`;
  const mint = await registerSsoAccount(username);
  const stub = await stubIdentityProvider(page, mint);

  await page.goto(loginPath());
  await page.getByRole('link', { name: `Continue with ${PROVIDER.name}` }).click();

  // One press went straight to the identity provider and back, with no question on the way.
  await waitForShell(page);
  expect(stub.redirectUrls).toHaveLength(1);
  await expect(prompt(page)).toHaveCount(0);
});
