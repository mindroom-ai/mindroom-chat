import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { test, expect } from '@playwright/test';

let server: Server;
let origin: string;
let expired = false;
let enabled = true;
let loginVisits = 0;
let probeStatus = 204;
let loginReturnsShell = false;
let oldRuntime = false;
let currentShell = false;
let worker: string;
const shell = '<!doctype html><script src="/runtime-config.js"></script><h1>Cached chats</h1>';

async function workerSource(legacy: boolean) {
  const contents = legacy
    ? `
    import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
    import { registerRoute, NavigationRoute } from 'workbox-routing';
    precacheAndRoute([{url:'index.html',revision:'legacy'}, {url:'asset.txt',revision:'one'}]);
    registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
  `
    : "import './src/sw.ts';";
  const result = await build({
    stdin: { contents, resolveDir: process.cwd() },
    bundle: true,
    write: false,
    format: 'iife',
    define: {
      'self.__WB_MANIFEST': JSON.stringify([
        { url: 'index.html', revision: 'current' },
        { url: 'asset.txt', revision: 'one' },
      ]),
    },
  });
  return result.outputFiles[0].text;
}

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url!, origin);
    response.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/runtime-config.js') {
      response.setHeader('Content-Type', 'application/javascript');
      response.end(
        oldRuntime
          ? 'window.__APP_BASE_PATH__ = "/"; window.__ENABLE_SERVICE_WORKER__ = true;'
          : readFileSync('public/runtime-config.js', 'utf8').replace(
              'window.__AUTHENTICATION_RECOVERY_CONFIG__ = null;',
              `window.__AUTHENTICATION_RECOVERY_CONFIG__ = ${
                enabled
                  ? JSON.stringify({
                      probeUrl: '/authentication-recovery-probe',
                      navigationUrl: '/login',
                      timeoutMs: 1000,
                    })
                  : 'null'
              };`
            )
      );
    } else if (url.pathname === '/authentication-recovery.js') {
      response.setHeader('Content-Type', 'application/javascript');
      response.end(readFileSync('public/authentication-recovery.js'));
    } else if (url.pathname === '/sw.js') {
      response.setHeader('Content-Type', 'application/javascript');
      response.end(worker);
    } else if (url.pathname === '/other/sw.js') {
      response.setHeader('Content-Type', 'application/javascript');
      response.end("self.addEventListener('install',()=>self.skipWaiting());");
    } else if (url.pathname === '/authentication-recovery-probe') {
      response.writeHead(expired ? 401 : probeStatus);
      response.end();
    } else if (url.pathname === '/login') {
      loginVisits += 1;
      response.setHeader('Content-Type', 'text/html');
      response.end(
        loginReturnsShell
          ? shell
          : "<h1>Proxy sign-in</h1><button onclick=\"fetch('/session',{method:'POST'}).then(()=>location.href='/room?tab=one#event')\">Sign in</button>"
      );
    } else if (url.pathname === '/session') {
      expired = false;
      response.end();
    } else if (url.pathname === '/asset.txt') {
      response.end('cached asset');
    } else {
      response.setHeader('Content-Type', 'text/html');
      const scripts =
        readFileSync('index.html', 'utf8').match(
          /<script src="\/(?:runtime-config|authentication-recovery)\.js"><\/script>/g
        ) ?? [];
      response.end(
        currentShell ? '<!doctype html>' + scripts.join('') + '<h1>Cached chats</h1>' : shell
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
test.beforeEach(() => {
  expired = false;
  enabled = true;
  loginVisits = 0;
  probeStatus = 204;
  loginReturnsShell = false;
  oldRuntime = false;
  currentShell = false;
});

async function seedStorage(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    localStorage.setItem('matrix-session', 'keep-token-and-keys');
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('matrix-crypto', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keys');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('keys', 'readwrite');
        transaction.objectStore('keys').put('keep-encryption-key', 'account');
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
      };
    });
    const cache = await caches.open('unrelated-assets');
    await cache.put('/keep.txt', new Response('keep-cache'));
    await navigator.serviceWorker.register('/other/sw.js', { scope: '/other/' });
  });
}

for (const mode of ['legacy', 'current', 'none'] as const) {
  test(`${mode} worker recovers through mutable bootstrap and preserves Matrix storage`, async ({
    page,
  }) => {
    worker = await workerSource(mode === 'legacy');
    await page.goto(`${origin}/room?tab=one#event`);
    await seedStorage(page);
    if (mode !== 'none') {
      await page.evaluate(async () => {
        await navigator.serviceWorker.register('/sw.js?non-disruptive-update=1');
        await navigator.serviceWorker.ready;
      });
      await page.reload();
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    }
    expired = true;
    // A normal installed-app launch is sufficient; no special URL needed.
    await page.reload();
    await expect(page.getByRole('heading')).toHaveText('Proxy sign-in');
    expect(loginVisits).toBe(1);
    expect(new URL(page.url()).hash).toBe('#event');
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(false);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading')).toHaveText('Cached chats');
    const state = await page.evaluate(async () => ({
      token: localStorage.getItem('matrix-session'),
      key: await new Promise((resolve) => {
        const request = indexedDB.open('matrix-crypto');
        request.onsuccess = () => {
          const database = request.result;
          const read = database.transaction('keys').objectStore('keys').get('account');
          read.onsuccess = () => {
            resolve(read.result);
            database.close();
          };
        };
      }),
      cached: await (await (await caches.open('unrelated-assets')).match('/keep.txt'))?.text(),
      registrations: (
        await navigator.serviceWorker.getRegistrations()
      ).map((item) => new URL(item.scope).pathname),
      precaches: (await caches.keys()).filter((name) => name.startsWith('workbox-precache')),
    }));
    expect(state.token).toBe('keep-token-and-keys');
    expect(state.key).toBe('keep-encryption-key');
    expect(state.cached).toBe('keep-cache');
    expect(state.registrations).toEqual(['/other/']);
    if (mode !== 'none') expect(state.precaches.length).toBeGreaterThan(0);
  });
}

test('legacy Workbox intercepts marker-only recovery, then native recovery escapes', async ({
  page,
}) => {
  enabled = false;
  worker = await workerSource(true);
  await page.goto(`${origin}/room#event`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  expired = true;
  await page.goto(`${origin}/login?authentication-recovery-navigation=1#event`);
  await expect(page.getByRole('heading')).toHaveText('Cached chats');
  expect(loginVisits).toBe(0);
  enabled = true;
  await page.reload();
  await expect(page.getByRole('heading')).toHaveText('Proxy sign-in');
  expect(loginVisits).toBe(1);
});

test('denial and gateway failures keep the app usable and do not unregister', async ({ page }) => {
  worker = await workerSource(true);
  await page.goto(`${origin}/room`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  for (const status of [403, 502]) {
    probeStatus = status;
    await page.reload();
    await expect(page.getByRole('heading')).toHaveText('Cached chats');
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    expect(loginVisits).toBe(0);
  }
});

test('a misconfigured sign-in destination cannot reload the cached app repeatedly', async ({
  page,
}) => {
  worker = await workerSource(true);
  await page.goto(origin + '/room');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  expired = true;
  loginReturnsShell = true;
  await page.reload();
  await expect.poll(() => loginVisits).toBe(1);
  await expect(page.getByRole('heading')).toHaveText('Cached chats');
  const result = await page.evaluate(async () => {
    const recovery = window as typeof window & {
      __AUTHENTICATION_RECOVERY_READY__: Promise<unknown>;
      __AUTHENTICATION_RECOVERY__: {
        check: () => Promise<string>;
        navigate: () => Promise<string>;
      };
    };
    await recovery.__AUTHENTICATION_RECOVERY_READY__;
    return Promise.all([
      recovery.__AUTHENTICATION_RECOVERY__.check(),
      recovery.__AUTHENTICATION_RECOVERY__.navigate(),
    ]);
  });
  expect(result).toEqual(['blocked', 'blocked']);
  expect(loginVisits).toBe(1);
});

test('current HTML retains explicit recovery with an unchanged custom runtime script', async ({
  page,
}) => {
  oldRuntime = true;
  currentShell = true;
  await page.goto(origin + '/room#event');
  const result = await page.evaluate(async () => {
    const recovery = (
      window as typeof window & { __AUTHENTICATION_RECOVERY__?: { check: () => Promise<string> } }
    ).__AUTHENTICATION_RECOVERY__;
    return recovery?.check();
  });
  expect(result).toBe('disabled');
  await page.evaluate(() => {
    void (
      window as typeof window & { __AUTHENTICATION_RECOVERY__: { navigate: () => Promise<string> } }
    ).__AUTHENTICATION_RECOVERY__.navigate();
  });
  await expect(page).toHaveURL(/authentication-recovery-navigation=1#event$/);
  await expect(page.getByRole('heading')).toHaveText('Cached chats');
});
