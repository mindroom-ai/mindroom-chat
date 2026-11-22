import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { expect, test } from '@playwright/test';
import { loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import { COMPOSER_NAME } from '../helpers/composerName';
import { createRoom } from '../helpers/createRoom';
import { DISPOSABLE_HOMESERVER } from '../helpers/disposableAccounts';
import { launchDesktop } from '../helpers/electronApp';
import { joinRoom, loginToMatrix, matrixFetch } from '../helpers/matrix';

const APP_ORIGIN = 'capacitor://localhost';

type Telemetry = {
  blockedUrls: string[];
  networkPermissions: string[];
};

const readTelemetry = async (
  app: Awaited<ReturnType<typeof launchDesktop>>['app']
): Promise<Telemetry> =>
  app.evaluate(
    () =>
      (globalThis as { __mindroomTestTelemetry?: Telemetry }).__mindroomTestTelemetry ?? {
        blockedUrls: [],
        networkPermissions: [],
      }
  );

const startProbeServer = async () => {
  let fetchOrigin: string | undefined;
  let fetchAuth: string | undefined;
  let wsOrigin: string | undefined;
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
    if (req.url === '/probe') {
      fetchOrigin = req.headers.origin;
      fetchAuth = req.headers.authorization;
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === '/_matrix/client/versions') {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ versions: ['v1.11'] }));
      return;
    }
    if (req.url === '/_matrix/client/v3/keys/query') {
      sockets.add(req.socket);
      return;
    }
    if (req.url === '/_matrix/client/v3/login') {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          flows: [
            {
              type: 'm.login.sso',
              identity_providers: [{ id: 'apple', name: 'Apple', brand: 'apple' }],
            },
          ],
        })
      );
      return;
    }
    res.writeHead(404, cors);
    res.end();
  });

  server.on('upgrade', (req, socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    wsOrigin = req.headers.origin;
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n')
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    port,
    result: () => ({ fetchOrigin, fetchAuth, wsOrigin }),
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

test.describe('Electron desktop shell', () => {
  test('starts offline on capacitor://localhost with secure context, IndexedDB, no SW and persistent storage', async () => {
    const session = await launchDesktop({ offline: true });
    try {
      const { page } = session;
      await expect(page.locator('input[name="serverInput"]')).toBeVisible();

      const env = await page.evaluate(async () => {
        const idbOk = await new Promise<boolean>((resolve) => {
          const req = indexedDB.open('mindroom-e2e-probe', 1);
          req.onupgradeneeded = () => {
            req.result.createObjectStore('kv');
          };
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('kv', 'readwrite');
            tx.objectStore('kv').put('ok', 'k');
            tx.oncomplete = () => {
              db.close();
              indexedDB.deleteDatabase('mindroom-e2e-probe');
              resolve(true);
            };
            tx.onerror = () => resolve(false);
          };
          req.onerror = () => resolve(false);
        });

        let swCount = 0;
        let swRegisterRejected = true;
        if ('serviceWorker' in navigator && navigator.serviceWorker) {
          try {
            const regs = await navigator.serviceWorker.getRegistrations();
            swCount = regs.length;
          } catch {
            // allowServiceWorkers: false makes getRegistrations reject with InvalidStateError.
            swCount = 0;
          }
          try {
            await navigator.serviceWorker.register('/sw.js');
            swRegisterRejected = false;
          } catch {
            swRegisterRejected = true;
          }
        }

        return {
          origin: window.location.origin,
          isSecureContext: window.isSecureContext,
          shell: document.documentElement.dataset.shell,
          idbOk,
          swCount,
          swRegisterRejected,
        };
      });

      expect(env).toEqual({
        origin: APP_ORIGIN,
        isSecureContext: true,
        shell: 'desktop',
        idbOk: true,
        swCount: 0,
        swRegisterRejected: true,
      });

      await expect.poll(() => page.evaluate(() => navigator.storage.persisted())).toBe(true);
    } finally {
      await session.close();
    }
  });

  test('sends capacitor://localhost Origin on fetch with Authorization and WebSocket to 127.0.0.1', async () => {
    const probe = await startProbeServer();
    const session = await launchDesktop();
    try {
      const { app, page } = session;
      await expect(page.locator('input[name="serverInput"]')).toBeVisible();

      const clientResult = await page.evaluate(async (port: number) => {
        const res = await fetch(`http://127.0.0.1:${port}/probe`, {
          headers: { Authorization: 'Bearer desktop-e2e-token' },
        });
        const wsOpened = await new Promise<boolean>((resolve) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
          ws.addEventListener('open', () => {
            ws.close();
            resolve(true);
          });
          ws.addEventListener('error', () => resolve(false));
        });
        return { status: res.status, wsOpened };
      }, probe.port);

      expect(clientResult).toEqual({ status: 200, wsOpened: true });
      expect(probe.result()).toEqual({
        fetchOrigin: APP_ORIGIN,
        fetchAuth: 'Bearer desktop-e2e-token',
        wsOrigin: APP_ORIGIN,
      });

      const telemetry = await readTelemetry(app);
      test.info().annotations.push({
        type: 'network-permission-queries',
        description:
          telemetry.networkPermissions.length > 0
            ? telemetry.networkPermissions.join(', ')
            : 'none',
      });
    } finally {
      await session.close();
      await probe.close();
    }
  });

  test('blocks frame-page main-frame navigation, external opens, and allows subframe navigation', async () => {
    const session = await launchDesktop({ offline: true });
    try {
      const { app, page } = session;
      await expect(page.locator('input[name="serverInput"]')).toBeVisible();

      const spellings = [
        '/pdf-frame.html',
        '/PDF-FRAME.HTML',
        '/pdf-frame%2ehtml',
        '/%70df-frame.html',
        '//pdf-frame.html',
        '/pdf-frame.html/',
        '/index',
        '/pdf-frame.html?x=1',
      ];
      for (const targetPath of spellings) {
        const targetUrl = `${APP_ORIGIN}${targetPath}`;
        await page.evaluate((target: string) => {
          window.location.assign(target);
        }, targetUrl);
        await page.waitForTimeout(150);
        await page.waitForLoadState('domcontentloaded');
        const state = await page.evaluate(() => ({
          origin: window.location.origin,
          title: document.title,
          hasRobotsNoIndex: document.querySelector('meta[name="robots"]') !== null,
        }));
        expect(state.origin, targetUrl).toBe(APP_ORIGIN);
        expect(state.title, targetUrl).not.toBe('PDF');
        expect(state.hasRobotsNoIndex, targetUrl).toBe(false);
      }

      // Exercise webRequest.onBeforeRequest directly by loading frame pages from main (bypasses will-navigate).
      for (const directUrl of [
        `${APP_ORIGIN}/pdf-frame.html`,
        `${APP_ORIGIN}/%70df-frame%2ehtml`,
      ]) {
        const result = await app.evaluate(async ({ BrowserWindow }, target: string) => {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) return { rejected: false, code: '', title: '', hasRobots: false };
          let rejected = false;
          let code = '';
          try {
            await win.loadURL(target);
          } catch (err) {
            rejected = true;
            code = String((err as { code?: unknown }).code ?? '');
          }
          const doc = (await win.webContents.executeJavaScript(
            `({ title: document.title, hasRobots: document.querySelector('meta[name="robots"]') !== null })`
          )) as { title: string; hasRobots: boolean };
          return { rejected, code, ...doc };
        }, directUrl);
        expect(result.rejected, directUrl).toBe(true);
        expect(result.code, directUrl).toBe('ERR_BLOCKED_BY_CLIENT');
        expect(result.title, directUrl).not.toBe('PDF');
        expect(result.hasRobots, directUrl).toBe(false);
      }

      // Return to the sign-in root after exercising blocked and SPA spellings.
      await page.goto(`${APP_ORIGIN}/`);
      await expect(page.locator('input[name="serverInput"]')).toBeVisible();

      // Click outside link, window.open, and top-level navigation away.
      await page.evaluate(() => {
        const link = document.createElement('a');
        link.id = 'e2e-outside-link';
        link.href = 'https://example.org/out';
        link.textContent = 'Outside';
        link.style.cssText = 'position:fixed;top:40px;left:40px;z-index:10000;';
        document.body.append(link);
      });
      const linkBox = await page.locator('#e2e-outside-link').boundingBox();
      expect(linkBox).not.toBeNull();
      await page.mouse.click(linkBox!.x + linkBox!.width / 2, linkBox!.y + linkBox!.height / 2);

      const opened = await page.evaluate(() => {
        const w = window.open('https://example.org/popup');
        window.location.assign('https://example.org/nav');
        return w !== null;
      });
      await page.waitForTimeout(150);

      expect(opened).toBe(false);
      expect(app.windows()).toHaveLength(1);
      expect(await page.evaluate(() => window.location.origin)).toBe(APP_ORIGIN);

      const telemetry = await readTelemetry(app);
      expect(telemetry.blockedUrls).toEqual(
        expect.arrayContaining([
          'https://example.org/out',
          'https://example.org/popup',
          'https://example.org/nav',
        ])
      );

      // A subframe navigating inside itself is not stopped.
      const subframeOk = await page.evaluate(async () => {
        const frame = document.createElement('iframe');
        const loaded = new Promise<void>((resolve) => {
          frame.addEventListener('load', () => resolve(), { once: true });
        });
        frame.src = '/pdf-frame.html#first';
        document.body.append(frame);
        await loaded;
        const firstHash = frame.contentWindow?.location.hash;
        const reloaded = new Promise<void>((resolve) => {
          frame.addEventListener('load', () => resolve(), { once: true });
        });
        if (frame.contentWindow) frame.contentWindow.location.hash = '#second';
        await reloaded;
        const secondHash = frame.contentWindow?.location.hash;
        const title = frame.contentDocument?.title;
        frame.remove();
        return { firstHash, secondHash, title };
      });
      expect(subframeOk).toEqual({
        firstHash: '#first',
        secondHash: '#second',
        title: 'PDF',
      });
    } finally {
      await session.close();
    }
  });

  test('applies 28px titlebar inset, 0 in fullscreen, and keeps real Dialog and PopOut overlays no-drag and clickable', async () => {
    const probe = await startProbeServer();
    const session = await launchDesktop();
    try {
      const { app, page } = session;
      await expect(page.locator('input[name="serverInput"]')).toBeVisible();

      const layout = await page.evaluate(() => {
        const root = document.getElementById('root');
        const drag = document.querySelector('[data-titlebar-drag]');
        return {
          paddingTop: root ? getComputedStyle(root).paddingTop : null,
          dragHeight: drag ? getComputedStyle(drag).height : null,
          dragRegion: drag ? getComputedStyle(drag).getPropertyValue('-webkit-app-region') : null,
        };
      });
      expect(layout).toEqual({ paddingTop: '28px', dragHeight: '28px', dragRegion: 'drag' });

      const clickInsideStrip = async (target: ReturnType<typeof page.getByRole>) => {
        await expect(target).toBeVisible();
        await target.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const container =
            el.closest<HTMLElement>('[role="alertdialog"], [role="dialog"], [role="menu"]') ??
            el.parentElement;
          if (!container) return;
          const containerRect = container.getBoundingClientRect();
          const dy = 14 - (rect.top + rect.height / 2);
          container.style.position = 'fixed';
          container.style.top = `${containerRect.top + dy}px`;
          container.style.left = '120px';
          container.style.right = 'auto';
        });
        expect(
          await target.evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))
        ).toBe('no-drag');
        const dragRect = await page.locator('[data-titlebar-drag]').boundingBox();
        const box = await target.boundingBox();
        expect(dragRect).not.toBeNull();
        expect(box).not.toBeNull();
        const cx = box!.x + box!.width / 2;
        const cy = box!.y + box!.height / 2;
        expect(cx).toBeGreaterThanOrEqual(dragRect!.x);
        expect(cx).toBeLessThanOrEqual(dragRect!.x + dragRect!.width);
        expect(cy).toBeGreaterThanOrEqual(dragRect!.y);
        expect(cy).toBeLessThan(dragRect!.y + dragRect!.height);
        await page.mouse.click(cx, cy);
      };

      // Real ModalLayer/Dialog: navigate to an unlisted local server so UnlistedServerPrompt opens.
      await page.goto(
        `${APP_ORIGIN}/login/${encodeURIComponent(`http://127.0.0.1:${probe.port}`)}`
      );
      await page.getByRole('button', { name: /apple/i }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      await clickInsideStrip(dialog.getByRole('button', { name: /cancel/i }));
      await expect(dialog).toHaveCount(0);

      // Real PopOut Menu: seed a session against the local stub so ClientRoot renders StartupRecoveryMenu.
      await page.evaluate((port: number) => {
        const baseUrl = `http://127.0.0.1:${port}`;
        const sessionId = `${baseUrl}|@e2e:localhost`;
        localStorage.setItem(
          'mindroom_multi_account_store',
          JSON.stringify({
            version: 1,
            activeSessionId: sessionId,
            sessions: [
              {
                sessionId,
                baseUrl,
                userId: '@e2e:localhost',
                deviceId: 'E2EDEVICE',
                accessToken: 'fake-token',
                lastUsedAt: Date.now(),
              },
            ],
          })
        );
      }, probe.port);
      await page.goto(`${APP_ORIGIN}/home`);
      const recoveryTrigger = page.getByRole('button', { name: /startup recovery options/i });
      await expect(recoveryTrigger).toBeVisible();
      await recoveryTrigger.click();

      await clickInsideStrip(page.getByRole('menuitem', { name: /remove account/i }));
      await expect(page.locator('input[name="serverInput"]')).toBeVisible();

      // Fullscreen toggles --app-inset-top to 0px via enter-full-screen / leave-full-screen.
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return;
        win.setFullScreen(true);
        // Headless Linux without a full window manager may not emit enter-full-screen on setFullScreen.
        if (process.platform === 'linux') win.emit('enter-full-screen');
      });
      await expect
        .poll(() =>
          page.evaluate(() => {
            const root = document.getElementById('root');
            return root ? getComputedStyle(root).paddingTop : null;
          })
        )
        .toBe('0px');

      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return;
        win.setFullScreen(false);
        if (process.platform === 'linux') win.emit('leave-full-screen');
      });
      await expect
        .poll(() =>
          page.evaluate(() => {
            const root = document.getElementById('root');
            return root ? getComputedStyle(root).paddingTop : null;
          })
        )
        .toBe('28px');
    } finally {
      await session.close();
      await probe.close();
    }
  });

  test('reloads once when the renderer process dies', async () => {
    const session = await launchDesktop({ offline: true });
    try {
      const { app, page } = session;
      await expect(page.locator('input[name="serverInput"]')).toBeVisible();

      await page.evaluate(() => {
        (window as unknown as { __beforeCrash?: boolean }).__beforeCrash = true;
      });

      const pidBefore = await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return -1;
        const pid = win.webContents.getOSProcessId();
        process.kill(pid, 'SIGKILL');
        return pid;
      });
      expect(pidBefore).toBeGreaterThan(0);

      // Playwright marks the old Page crashed after SIGKILL; inspect the recovered WebContents directly.
      await expect
        .poll(async () =>
          app.evaluate(async ({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            if (!win || win.webContents.isCrashed()) return null;
            const pid = win.webContents.getOSProcessId();
            try {
              const info = (await win.webContents.executeJavaScript(
                `({
                  origin: window.location.origin,
                  beforeCrash: Boolean(window.__beforeCrash),
                  hasServerInput: document.querySelector('input[name="serverInput"]') !== null
                })`
              )) as { origin: string; beforeCrash: boolean; hasServerInput: boolean };
              return { pid, ...info };
            } catch {
              return null;
            }
          })
        )
        .toEqual({
          pid: expect.any(Number),
          origin: APP_ORIGIN,
          beforeCrash: false,
          hasServerInput: true,
        });

      const pidAfter = await app.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId() ?? -1
      );
      expect(pidAfter).toBeGreaterThan(0);
      expect(pidAfter).not.toBe(pidBefore);
    } finally {
      await session.close();
    }
  });

  test('@homeserver signs in with password, encrypts messages, decrypts on second account and after reload, and reaches LAN homeserver', async () => {
    const homeserver = process.env.E2E_HOMESERVER_URL ?? DISPOSABLE_HOMESERVER;
    const lanHomeserver = process.env.E2E_LAN_HOMESERVER_URL;
    expect(
      lanHomeserver,
      'E2E_LAN_HOMESERVER_URL must be set for the @homeserver desktop run'
    ).toBeTruthy();

    const suffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const registerUser = async (prefix: string) => {
      const username = `desktop_${prefix}_${suffix}`;
      const password = `Pass_${crypto.randomBytes(8).toString('hex')}`;
      const reg = await fetch(`${homeserver}/_matrix/client/v3/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          auth: { type: 'm.login.dummy' },
          inhibit_login: true,
        }),
      });
      expect(reg.ok, `registering ${username} on ${homeserver} (${reg.status})`).toBe(true);
      const apiSession = await loginToMatrix(homeserver, username, password);
      return { ...apiSession, username, password };
    };

    const alice = await registerUser('a');
    const bob = await registerUser('b');
    const roomId = await createRoom(homeserver, alice.accessToken, {
      name: `Desktop E2EE ${suffix}`,
      encrypted: true,
      invite: [bob.userId],
    });
    await joinRoom(homeserver, bob.accessToken, roomId);
    const messageText = `Encrypted desktop check ${suffix}`;

    const bobSession = await launchDesktop();
    const aliceSession = await launchDesktop();
    try {
      // Sign Bob in first so his device keys are published before Alice encrypts.
      await loginWithPassword(bobSession.page, {
        homeserver,
        username: bob.username,
        password: bob.password,
        baseUrl: APP_ORIGIN,
      });
      await loginWithPassword(aliceSession.page, {
        homeserver,
        username: alice.username,
        password: alice.password,
        baseUrl: APP_ORIGIN,
      });

      const roomUrl = `${APP_ORIGIN}/home/${encodeURIComponent(roomId)}`;
      await aliceSession.page.goto(roomUrl);
      const composer = aliceSession.page.getByRole('textbox', { name: COMPOSER_NAME }).first();
      await expect(composer).toBeVisible({ timeout: 20_000 });
      await composer.click();
      await aliceSession.page.keyboard.type(messageText);
      await aliceSession.page.keyboard.press('Enter');
      const aliceTimeline = aliceSession.page.getByTestId('room-virtual-inner');
      await expect(aliceTimeline.getByText(messageText)).toBeVisible({ timeout: 20_000 });

      // Assert the homeserver stored ciphertext (m.room.encrypted) and not plaintext.
      await expect
        .poll(async () => {
          const { chunk } = await matrixFetch<{
            chunk: Array<{ type: string; content?: { body?: string } }>;
          }>(homeserver, `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=20`, {
            accessToken: alice.accessToken,
          });
          return {
            hasEncrypted: chunk.some((ev) => ev.type === 'm.room.encrypted'),
            hasPlaintext: chunk.some((ev) => ev.content?.body === messageText),
          };
        })
        .toEqual({ hasEncrypted: true, hasPlaintext: false });

      // Assert the second account in its own profile decrypts the unique plaintext.
      await bobSession.page.goto(roomUrl);
      await expect(
        bobSession.page.getByTestId('room-virtual-inner').getByText(messageText)
      ).toBeVisible({ timeout: 20_000 });
      await expect(bobSession.page.getByText(/Unable to decrypt/i)).toHaveCount(0);

      // Reload Alice and verify the encrypted message still decrypts from persistent crypto storage.
      await aliceSession.page.reload();
      await waitForLoggedInShell(aliceSession.page);
      await expect(aliceTimeline.getByText(messageText)).toBeVisible({ timeout: 20_000 });
      await expect(aliceSession.page.getByText(/Unable to decrypt/i)).toHaveCount(0);

      // Probe the homeserver on the LAN address (must be set and reachable).
      const lanOk = await aliceSession.page.evaluate(async (url: string) => {
        const res = await fetch(`${url}/_matrix/client/versions`);
        return res.ok;
      }, lanHomeserver!);
      expect(lanOk).toBe(true);
    } finally {
      await aliceSession.close();
      await bobSession.close();
    }
  });
});
