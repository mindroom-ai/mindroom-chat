import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { expect, test, type Page } from '@playwright/test';
import { DISPOSABLE_HOMESERVER as HOMESERVER } from '../helpers/disposableAccounts';
import { assertNoUnexpectedViolations, launchDesktop } from '../helpers/electronApp';
import { loginPath, PROVIDER, registerSsoAccount, waitForShell } from '../helpers/ssoHomeserver';

const APP_ORIGIN = 'capacitor://localhost';

type Telemetry = { externalOpens: string[] };

const readExternalOpens = async (
  app: Awaited<ReturnType<typeof launchDesktop>>['app']
): Promise<string[]> =>
  app.evaluate(
    () =>
      (globalThis as { __mindroomTestTelemetry?: Telemetry }).__mindroomTestTelemetry
        ?.externalOpens ?? []
  );

const baseConfig = JSON.parse(fs.readFileSync(path.resolve('dist/config.json'), 'utf8')) as {
  homeserverList?: string[];
};

const listHomeservers = async (page: Page, extra: string[]): Promise<void> => {
  await page.route('**/config.json', async (route) => {
    await route.fulfill({
      json: { ...baseConfig, homeserverList: [...(baseConfig.homeserverList ?? []), ...extra] },
    });
  });
};

const advertiseSso = async (page: Page, homeserver: string): Promise<void> => {
  await page.route(`${homeserver}/_matrix/client/v3/login`, async (route) => {
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
};

const startSsoFromPage = async (
  app: Awaited<ReturnType<typeof launchDesktop>>['app'],
  page: Page,
  homeserver: string,
  previousCount: number
): Promise<URL> => {
  await page.goto(`${APP_ORIGIN}/login/${encodeURIComponent(homeserver)}`);
  const button = page.getByRole('button', { name: new RegExp(PROVIDER.name, 'i') });
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();
  await expect.poll(async () => (await readExternalOpens(app)).length).toBe(previousCount + 1);
  const opens = await readExternalOpens(app);
  const signInUrl = new URL(opens[previousCount]!);
  expect(signInUrl.origin).toBe(new URL(homeserver).origin);
  expect(signInUrl.pathname).toBe(`/_matrix/client/v3/login/sso/redirect/${PROVIDER.id}`);
  const redirectUrl = signInUrl.searchParams.get('redirectUrl');
  expect(redirectUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/[0-9a-f]+\/login\//);
  return new URL(redirectUrl!);
};

const startOtherHomeserver = async () => {
  const loginPosts: string[] = [];
  const sockets = new Set<Duplex>();
  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': req.headers.origin ?? '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/_matrix/client/versions') return json(200, { versions: ['v1.11'] });
    if (req.url === '/_matrix/client/v3/login' && req.method === 'GET') {
      return json(200, {
        flows: [{ type: 'm.login.sso', identity_providers: [PROVIDER] }, { type: 'm.login.token' }],
      });
    }
    if (req.url === '/_matrix/client/v3/login' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        loginPosts.push(Buffer.concat(chunks).toString('utf8'));
        json(403, { errcode: 'M_FORBIDDEN', error: 'Token is for another homeserver' });
      });
      return;
    }
    json(404, { errcode: 'M_NOT_FOUND', error: 'Not found' });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    loginPosts,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

test.afterEach(() => assertNoUnexpectedViolations());

test.describe('@homeserver Electron loopback SSO sign-in', () => {
  test('signs in on a valid loopback return and ignores a replay', async () => {
    const username = `electron_sso_ok_${Date.now()}`;
    const mintToken = await registerSsoAccount(username);
    const session = await launchDesktop();
    try {
      const { app, page } = session;
      await listHomeservers(page, [HOMESERVER]);
      await advertiseSso(page, HOMESERVER);

      const redirect = await startSsoFromPage(app, page, HOMESERVER, 0);
      const token = await mintToken();
      const callbackUrl = `${redirect.href}&loginToken=${encodeURIComponent(token)}`;

      const first = await fetch(callbackUrl);
      expect(first.status).toBe(200);
      expect(first.headers.get('cache-control')).toBe('no-store');
      await waitForShell(page);

      // Replaying the same return gets 404 and does not disturb the signed-in session.
      const replay = await fetch(callbackUrl);
      expect(replay.status).toBe(404);
      expect(page.url()).toContain('/home');
    } finally {
      await session.close();
    }
  });

  test('refuses an unknown nonce, a return after 30 minutes, and a token for another homeserver', async () => {
    const username = `electron_sso_bad_${Date.now()}`;
    const mintToken = await registerSsoAccount(username);
    const otherHs = await startOtherHomeserver();
    const session = await launchDesktop();
    try {
      const { app, page } = session;
      await listHomeservers(page, [HOMESERVER, otherHs.baseUrl]);
      await advertiseSso(page, HOMESERVER);

      // 1. Unknown nonce -> loopback rejects with 404 and page stays on login.
      const redirect1 = await startSsoFromPage(app, page, HOMESERVER, 0);
      const wrongNonce = new URL(redirect1.href);
      wrongNonce.searchParams.set('ssoNonce', '00000000000000000000000000000000');
      wrongNonce.searchParams.set('loginToken', await mintToken());
      expect((await fetch(wrongNonce.href)).status).toBe(404);
      expect(page.url()).toContain(loginPath());

      // 2. Return after 30 minutes -> main expires pending sign-in and rejects with 404.
      const redirect2 = await startSsoFromPage(app, page, HOMESERVER, 1);
      await app.evaluate(() => {
        const realNow = Date.now;
        Object.assign(globalThis, { __realDateNow: realNow });
        Date.now = () => realNow() + 30 * 60 * 1000 + 1_000;
      });
      try {
        const late = `${redirect2.href}&loginToken=${encodeURIComponent(await mintToken())}`;
        expect((await fetch(late)).status).toBe(404);
      } finally {
        await app.evaluate(() => {
          const realNow = (globalThis as { __realDateNow?: typeof Date.now }).__realDateNow;
          if (realNow) Date.now = realNow;
        });
      }
      expect(page.url()).toContain(loginPath());

      // 3. Token for another homeserver:
      // (a) Changing the callback path to target HOMESERVER while pending is for otherHs gets 404.
      // (b) Delivering HOMESERVER's token to otherHs's callback only posts to otherHs (which rejects it)
      //     and never signs in at HOMESERVER.
      const redirectOther = await startSsoFromPage(app, page, otherHs.baseUrl, 2);
      const tokenForHs = await mintToken();
      const swappedPath = new URL(redirectOther.href);
      swappedPath.pathname = swappedPath.pathname.replace(
        encodeURIComponent(otherHs.baseUrl),
        encodeURIComponent(HOMESERVER)
      );
      swappedPath.searchParams.set('loginToken', tokenForHs);
      expect((await fetch(swappedPath.href)).status).toBe(404);

      const otherCallback = `${redirectOther.href}&loginToken=${encodeURIComponent(tokenForHs)}`;
      expect((await fetch(otherCallback)).status).toBe(200);
      await expect.poll(() => otherHs.loginPosts.length).toBe(1);
      expect(page.url()).toContain('/login/');
    } finally {
      await session.close();
      await otherHs.close();
    }
  });

  test('reopens a closed main window on a valid return and signs in', async () => {
    const username = `electron_sso_reopen_${Date.now()}`;
    const mintToken = await registerSsoAccount(username);
    const session = await launchDesktop();
    try {
      const { app, page } = session;
      await listHomeservers(page, [HOMESERVER]);
      await advertiseSso(page, HOMESERVER);

      const redirect = await startSsoFromPage(app, page, HOMESERVER, 0);
      const token = await mintToken();

      // On Linux, closing the last window quits the app; hold an auxiliary hidden window so the
      // main window can close and be recreated by focusMainWindow() on the loopback return.
      const keepAliveId =
        process.platform === 'darwin'
          ? undefined
          : await app.evaluate(({ BrowserWindow }) => {
              const aux = new BrowserWindow({ show: false });
              return aux.id;
            });

      try {
        await page.close();
        const reopenedPromise = app.waitForEvent('window');
        const res = await fetch(`${redirect.href}&loginToken=${encodeURIComponent(token)}`);
        expect(res.status).toBe(200);

        const reopened = await reopenedPromise;
        await session.watchPage(reopened);
        await waitForShell(reopened);
      } finally {
        if (keepAliveId !== undefined) {
          await app.evaluate(({ BrowserWindow }, id: number) => {
            const aux = BrowserWindow.fromId(id);
            if (aux && !aux.isDestroyed()) aux.destroy();
          }, keepAliveId);
        }
      }
    } finally {
      await session.close();
    }
  });
});
