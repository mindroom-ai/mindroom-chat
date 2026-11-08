import { expect, type Page } from '@playwright/test';
import { activeAccountButton, waitForLoggedInShell } from './auth';

// Single sign-on against the disposable homeserver of `just hs-up`. The test homeserver has no
// identity provider, so two requests are answered here: the login flows gain an `m.login.sso`
// flow, and the SSO redirect stands in for the provider by sending the browser straight back
// with a login token. That token is a real one, minted by the homeserver for a real account
// (`POST /login/get_token`), so the client's token exchange and the session it starts are real.

export const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
export const PASSWORD = 'sso-spec-password';
export const PROVIDER = { id: 'oidc-e2e', name: 'E2E Identity' };

export const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

export const postJson = async (path: string, body: unknown, accessToken?: string) => {
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

/** Registers an account; the returned function mints a fresh login token for it on each call. */
export const registerSsoAccount = async (username: string): Promise<() => Promise<string>> => {
  const registered = await postJson('/v3/register', {
    username,
    password: PASSWORD,
    auth: { type: 'm.login.dummy' },
  });
  expect(registered.status, `registering ${username}`).toBe(200);
  const identifier = { type: 'm.id.user', user: username };
  return async () => {
    // The homeserver asks for the password again before it hands out a login token.
    const minted = await postJson(
      '/v1/login/get_token',
      { auth: { type: 'm.login.password', identifier, password: PASSWORD } },
      registered.body.access_token as string
    );
    expect(minted.status, 'minting a login token').toBe(200);
    return minted.body.login_token as string;
  };
};

/** Registers an account and returns a fresh login token for it, as an SSO callback would. */
export const mintLoginToken = async (username: string): Promise<string> =>
  (await registerSsoAccount(username))();

/**
 * Lists the slot's homeserver in the deployment's `config.json`, as a deployment lists its own
 * server: its sign-in buttons then start at once. The shipped config lists only mindroom.chat
 * and matrix.org, so without this the slot's server counts as one the deployment does not offer.
 */
export const listSlotHomeserver = async (page: Page): Promise<void> => {
  await page.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as { homeserverList?: string[] };
    await route.fulfill({
      response,
      json: { ...config, homeserverList: [...(config.homeserverList ?? []), HOMESERVER] },
    });
  });
};

export type SsoStub = { redirectUrls: string[] };

/**
 * Advertises one identity provider and answers its redirect by returning to the client's
 * `redirectUrl` with `loginToken`, the way the homeserver does after the provider signs in.
 * `alterReturn` changes the return address first, as a crafted `redirectUrl` would.
 */
export const stubIdentityProvider = async (
  page: Page,
  loginToken: () => string | Promise<string>,
  alterReturn?: (back: URL) => void
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
      alterReturn?.(back);
      back.searchParams.set('loginToken', await loginToken());
      await route.fulfill({ status: 302, headers: { location: back.href } });
    }
  );
  return stub;
};

/** The signed-in shell; a first sync on a busy machine can outlast the shared helper's wait. */
export const waitForShell = async (page: Page) => {
  await expect(activeAccountButton(page)).toBeVisible({
    timeout: 90_000,
  });
  await waitForLoggedInShell(page);
};

export const loginPath = (search = '') => `/login/${encodeURIComponent(HOMESERVER)}${search}`;
