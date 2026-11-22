import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { expect, test } from '@playwright/test';
import { assertNoUnexpectedViolations, launchDesktop } from '../helpers/electronApp';

const APP_ORIGIN = 'capacitor://localhost';
const ROOM_ID = '!links-room:example.test';
const USER_ID = '@tester:example.test';
const SENDER_ID = '@alice:example.test';

type Telemetry = {
  blockedUrls: string[];
  networkPermissions: string[];
  externalOpens: string[];
};

const readTelemetry = async (
  app: Awaited<ReturnType<typeof launchDesktop>>['app']
): Promise<Telemetry> =>
  app.evaluate(
    () =>
      (globalThis as { __mindroomTestTelemetry?: Telemetry }).__mindroomTestTelemetry ?? {
        blockedUrls: [],
        networkPermissions: [],
        externalOpens: [],
      }
  );

type MatrixEventJson = {
  type: string;
  event_id: string;
  sender: string;
  origin_server_ts: number;
  room_id: string;
  content: Record<string, unknown>;
  state_key?: string;
};

const startMockMatrixServer = async (events: MatrixEventJson[]) => {
  const sockets = new Set<Duplex>();
  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': req.headers.origin ?? '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/_matrix/client/versions') return json(200, { versions: ['v1.11'] });
    if (url.pathname.endsWith('/account/whoami')) {
      return json(200, { user_id: USER_ID, device_id: 'E2EDEVICE' });
    }
    if (url.pathname.includes('/filter') && req.method === 'POST') {
      return json(200, { filter_id: 'f1' });
    }
    if (url.pathname.includes('/profile/')) {
      return json(200, { displayname: url.pathname.includes('alice') ? 'Alice' : 'Tester' });
    }
    if (url.pathname.endsWith('/pushrules/')) return json(200, { global: {} });
    if (url.pathname.endsWith('/room_keys/version')) {
      return json(404, { errcode: 'M_NOT_FOUND', error: 'No backup' });
    }
    if (url.pathname.endsWith('/keys/query')) return json(200, { device_keys: {}, failures: {} });
    if (url.pathname.endsWith('/keys/upload')) return json(200, { one_time_key_counts: {} });
    if (url.pathname.includes('/messages')) {
      return json(200, { chunk: [...events].reverse(), start: 's0', end: 'e0' });
    }
    if (url.pathname.includes('/relations/')) return json(200, { chunk: [] });
    if (url.pathname.endsWith('/sync')) {
      const since = url.searchParams.get('since');
      if (!since) {
        const now = Date.now();
        const state: MatrixEventJson[] = [
          {
            type: 'm.room.create',
            event_id: '$st_create',
            sender: SENDER_ID,
            origin_server_ts: now - 10_000,
            room_id: ROOM_ID,
            state_key: '',
            content: { room_version: '11', creator: SENDER_ID },
          },
          {
            type: 'm.room.name',
            event_id: '$st_name',
            sender: SENDER_ID,
            origin_server_ts: now - 9_000,
            room_id: ROOM_ID,
            state_key: '',
            content: { name: 'Links Room' },
          },
          {
            type: 'm.room.member',
            event_id: '$st_user',
            sender: USER_ID,
            origin_server_ts: now - 8_000,
            room_id: ROOM_ID,
            state_key: USER_ID,
            content: { membership: 'join', displayname: 'Tester' },
          },
          {
            type: 'm.room.member',
            event_id: '$st_sender',
            sender: SENDER_ID,
            origin_server_ts: now - 7_000,
            room_id: ROOM_ID,
            state_key: SENDER_ID,
            content: { membership: 'join', displayname: 'Alice' },
          },
        ];
        return json(200, {
          next_batch: 'b1',
          rooms: {
            join: {
              [ROOM_ID]: {
                state: { events: state },
                timeline: { events, limited: false, prev_batch: 'p0' },
                ephemeral: { events: [] },
                account_data: { events: [] },
                unread_notifications: { highlight_count: 0, notification_count: 0 },
              },
            },
          },
        });
      }
      return json(200, { next_batch: 'b1', rooms: { join: {} } });
    }
    json(200, {});
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

test.afterEach(() => assertNoUnexpectedViolations());

test.describe('Electron external link handling', () => {
  test('opens only trusted clicks on openable links/buttons, blocks scripted/forged opens, and isolates sandboxed frames', async () => {
    const session = await launchDesktop();
    try {
      const { app, page } = session;
      await expect(page.locator('input[name="serverInput"]')).toBeVisible();

      // The bridge exposes no openExternal function.
      expect(await page.evaluate(() => 'openExternal' in (window.mindroomDesktop ?? {}))).toBe(
        false
      );

      // Inject controlled test elements for trusted vs scripted click checks.
      await page.evaluate(() => {
        const box = document.createElement('div');
        box.id = 'e2e-link-harness';
        box.style.position = 'fixed';
        box.style.top = '40px';
        box.style.left = '40px';
        box.style.zIndex = '99999';
        box.style.display = 'flex';
        box.style.flexDirection = 'column';
        box.style.gap = '6px';
        box.style.background = '#222';
        box.style.padding = '8px';

        const mk = <K extends keyof HTMLElementTagNameMap>(
          tag: K,
          id: string,
          text: string,
          attrs: Record<string, string>
        ) => {
          const el = document.createElement(tag);
          el.id = id;
          el.textContent = text;
          for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
          box.appendChild(el);
        };

        mk('a', 'e2e-link-primary', 'Primary', { href: 'https://example.org/primary' });
        mk('a', 'e2e-link-middle', 'Middle', { href: 'https://example.org/middle' });
        mk('a', 'e2e-link-scripted', 'Scripted', { href: 'https://example.org/scripted' });
        mk('button', 'e2e-btn-scripted', 'BtnScripted', {
          type: 'button',
          'data-open-external': 'https://example.org/btn-scripted',
        });
        mk('span', 'e2e-span-forged', 'SpanForged', {
          'data-open-external': 'https://example.org/span-forged',
        });
        mk('a', 'e2e-link-forged-attr', 'SameOriginLink', {
          href: '#stay',
          'data-open-external': 'https://example.org/link-forged',
        });
        mk('a', 'e2e-link-media', 'MediaLink', {
          href: 'https://hs.example/_matrix/client/v1/media/download/hs.example/abc',
        });
        mk('a', 'e2e-link-token', 'TokenLink', {
          href: 'https://example.org/secret?access_token=syt_leak',
        });
        mk('button', 'e2e-btn-js', 'JsBtn', {
          type: 'button',
          'data-open-external': 'javascript:alert(1)',
        });
        mk('a', 'e2e-link-file', 'FileLink', { href: 'file:///etc/passwd' });
        document.body.appendChild(box);
      });

      const clickEl = async (selector: string, button: 'left' | 'middle' = 'left') => {
        const pt = await page.evaluate((sel) => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
        }, selector);
        expect(pt, selector).not.toBeNull();
        await page.mouse.click(pt!.x, pt!.y, { button });
      };

      // Scripted opens and forged elements must open nothing.
      await page.evaluate(() => {
        (document.getElementById('e2e-link-scripted') as HTMLAnchorElement).click();
        (document.getElementById('e2e-btn-scripted') as HTMLButtonElement).click();
        window.open('https://example.org/window-open');
      });

      // Real clicks on span[data-open-external], same-origin a[data-open-external], media, token, js, file.
      await clickEl('#e2e-span-forged');
      await clickEl('#e2e-link-forged-attr');
      await clickEl('#e2e-link-media');
      await clickEl('#e2e-link-token');
      await clickEl('#e2e-btn-js');
      await clickEl('#e2e-link-file');

      // Now do real primary click and real middle click on allowed links:
      // once both appear, every earlier rejected action has already run its zero-timeout and IPC round-trip.
      await clickEl('#e2e-link-primary');
      await clickEl('#e2e-link-middle', 'middle');

      await expect
        .poll(async () => (await readTelemetry(app)).externalOpens)
        .toEqual(['https://example.org/primary', 'https://example.org/middle']);

      // Opaque sandboxed frame has no mindroomDesktop and cannot read parent.mindroomDesktop.
      const sandboxResult = await page.evaluate(
        () =>
          new Promise<{ own: boolean; parentBlocked: boolean }>((resolve) => {
            const onMessage = (e: MessageEvent) => {
              if (e.data && typeof e.data === 'object' && 'parentBlocked' in e.data) {
                window.removeEventListener('message', onMessage);
                resolve(e.data as { own: boolean; parentBlocked: boolean });
              }
            };
            window.addEventListener('message', onMessage);
            const iframe = document.createElement('iframe');
            iframe.src = `${window.location.origin}/canvas-frame.html`;
            iframe.addEventListener('load', () => {
              iframe.contentWindow?.postMessage(
                `<!DOCTYPE html><html><body><script>
                  let parentBlocked = false;
                  try { void window.parent.mindroomDesktop; } catch { parentBlocked = true; }
                  window.parent.postMessage({ own: 'mindroomDesktop' in window, parentBlocked }, '*');
                </script></body></html>`,
                '*'
              );
            });
            document.body.appendChild(iframe);
          })
      );
      expect(sandboxResult).toEqual({ own: false, parentBlocked: true });

      // No spelling of a frame page loads as the main frame.
      for (const spelling of [
        `${APP_ORIGIN}/canvas-frame.html`,
        `${APP_ORIGIN}/pdf-frame.html`,
        `${APP_ORIGIN}/%63anvas-frame.html`,
        `${APP_ORIGIN}//pdf-frame.html`,
      ]) {
        const blocked = await app.evaluate(async ({ BrowserWindow }, target: string) => {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) return false;
          try {
            await win.loadURL(target);
            return false;
          } catch {
            return true;
          }
        }, spelling);
        expect(blocked, spelling).toBe(true);
      }
    } finally {
      await session.close();
    }
  });

  test('confirms misleading links before opening once, and opens server from profile menu once', async () => {
    const now = Date.now();
    const mockServer = await startMockMatrixServer([
      {
        type: 'm.room.message',
        event_id: '$msg_misleading',
        sender: SENDER_ID,
        origin_server_ts: now - 1_000,
        room_id: ROOM_ID,
        content: {
          msgtype: 'm.text',
          body: 'https://good.example',
          format: 'org.matrix.custom.html',
          formatted_body:
            '<p><a href="https://evil.example/phish">https://good.example</a></p>' +
            '<p><a href="https://example.org/sentinel">sentinel</a></p>',
        },
      },
    ]);
    const session = await launchDesktop();
    try {
      const { app, page } = session;
      await page.evaluate(
        ({ baseUrl, userId }) => {
          const sessionId = `${baseUrl}|${userId}`;
          localStorage.setItem(
            'mindroom_multi_account_store',
            JSON.stringify({
              version: 1,
              activeSessionId: sessionId,
              sessions: [
                {
                  sessionId,
                  baseUrl,
                  userId,
                  deviceId: 'E2EDEVICE',
                  accessToken: 'fake-token',
                  lastUsedAt: Date.now(),
                },
              ],
            })
          );
        },
        { baseUrl: mockServer.baseUrl, userId: USER_ID }
      );
      await page.goto(`${APP_ORIGIN}/home/${encodeURIComponent(ROOM_ID)}`);

      const misleadingLink = page.getByRole('link', { name: 'https://good.example' });
      await expect(misleadingLink).toBeVisible({ timeout: 30_000 });

      // Click misleading link -> dialog opens; Cancel opens nothing.
      await misleadingLink.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: /cancel/i }).click();
      await expect(dialog).toHaveCount(0);

      // Click misleading link again -> Open link opens exactly once.
      await misleadingLink.click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: /open link/i }).click();
      await expect(dialog).toHaveCount(0);

      await expect
        .poll(async () => (await readTelemetry(app)).externalOpens)
        .toEqual(['https://evil.example/phish']);

      // Profile menu -> ServerChip -> Open in Browser opens once.
      await page.getByRole('button', { name: /alice/i }).first().click();
      const serverChip = page.getByRole('button', { name: 'example.test' });
      await expect(serverChip).toBeVisible();
      await serverChip.click();
      const openInBrowser = page.getByRole('menuitem', { name: /open in browser/i });
      await expect(openInBrowser).toBeVisible();
      await openInBrowser.click();

      await expect
        .poll(async () => (await readTelemetry(app)).externalOpens)
        .toEqual(['https://evil.example/phish', 'https://example.test']);
    } finally {
      await session.close();
      await mockServer.close();
    }
  });
});
