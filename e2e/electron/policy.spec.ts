import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { expect, test, type FrameLocator } from '@playwright/test';
import { launchDesktop } from '../helpers/electronApp';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const copyDir = (src: string, dest: string): void => {
  fs.cpSync(src, dest, { recursive: true });
};

const APP_ORIGIN = 'capacitor://localhost';
const USER_ID = '@e2e:localhost';
const AGENT_ID = '@mindroom_agent:localhost';
const ROOM_ID = '!canvas:localhost';
const ROOT_ID = '$root';

const MINIMAL_PDF = `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000054 00000 n 
0000000105 00000 n 
trailer<</Size 4/Root 1 0 R>>
startxref
167
%%EOF
`;

type MatrixEventJson = {
  type: string;
  event_id: string;
  sender: string;
  origin_server_ts: number;
  room_id: string;
  content: Record<string, unknown>;
  state_key?: string;
};

const startMockMatrixServer = async (initialEvents: MatrixEventJson[]) => {
  const events: MatrixEventJson[] = [...initialEvents];
  let probeHits = 0;
  const waiters: Array<() => void> = [];
  const sockets = new Set<Duplex>();

  const notify = () => {
    for (const wake of waiters.splice(0)) wake();
  };

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

    if (url.pathname === '/canvas-probe') {
      probeHits += 1;
      json(200, { leaked: true });
      return;
    }
    if (url.pathname === '/_matrix/client/versions') {
      json(200, { versions: ['v1.11'] });
      return;
    }
    if (url.pathname.endsWith('/account/whoami')) {
      json(200, { user_id: USER_ID, device_id: 'E2EDEVICE' });
      return;
    }
    if (url.pathname.includes('/filter') && req.method === 'POST') {
      json(200, { filter_id: 'f1' });
      return;
    }
    if (url.pathname.includes('/profile/')) {
      json(200, { displayname: url.pathname.includes('agent') ? 'Agent' : 'Tester' });
      return;
    }
    if (url.pathname.endsWith('/pushrules/')) {
      json(200, { global: {} });
      return;
    }
    if (url.pathname.endsWith('/room_keys/version')) {
      json(404, { errcode: 'M_NOT_FOUND', error: 'No backup' });
      return;
    }
    if (url.pathname.endsWith('/keys/query')) {
      json(200, { device_keys: {}, failures: {} });
      return;
    }
    if (url.pathname.endsWith('/keys/upload')) {
      json(200, { one_time_key_counts: {} });
      return;
    }
    if (url.pathname.includes('/event/')) {
      const id = decodeURIComponent(url.pathname.split('/event/')[1] ?? '');
      const found = events.find((ev) => ev.event_id === id);
      if (found) json(200, found);
      else json(404, { errcode: 'M_NOT_FOUND', error: 'Not found' });
      return;
    }
    if (url.pathname.includes('/messages')) {
      json(200, { chunk: [...events].reverse(), start: 's0', end: 'e0' });
      return;
    }
    if (url.pathname.includes('/relations/')) {
      const parts = url.pathname.split('/relations/')[1]?.split('/') ?? [];
      const targetId = decodeURIComponent(parts[0] ?? '');
      const relType = parts[1] ? decodeURIComponent(parts[1]) : undefined;
      const matched = events.filter((ev) => {
        const rel = ev.content['m.relates_to'] as
          | { rel_type?: string; event_id?: string }
          | undefined;
        return rel?.event_id === targetId && (!relType || rel.rel_type === relType);
      });
      json(200, { chunk: matched.reverse() });
      return;
    }
    if (url.pathname.includes('/context/')) {
      const id = decodeURIComponent(url.pathname.split('/context/')[1] ?? '');
      const found = events.find((ev) => ev.event_id === id) ?? events[0];
      json(200, {
        event: found,
        events_before: [],
        events_after: [],
        start: 's0',
        end: 'e0',
        state: [],
      });
      return;
    }
    if (url.pathname.endsWith('/sync')) {
      const sinceRaw = url.searchParams.get('since');
      const since = sinceRaw ? Number.parseInt(sinceRaw, 10) : 0;
      const answer = () => {
        if (since === 0) {
          const now = Date.now();
          const state: MatrixEventJson[] = [
            {
              type: 'm.room.create',
              event_id: '$st_create',
              sender: AGENT_ID,
              origin_server_ts: now - 10_000,
              room_id: ROOM_ID,
              state_key: '',
              content: { room_version: '11', creator: AGENT_ID },
            },
            {
              type: 'm.room.name',
              event_id: '$st_name',
              sender: AGENT_ID,
              origin_server_ts: now - 9_000,
              room_id: ROOM_ID,
              state_key: '',
              content: { name: 'Canvas Policy Room' },
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
              event_id: '$st_agent',
              sender: AGENT_ID,
              origin_server_ts: now - 7_000,
              room_id: ROOM_ID,
              state_key: AGENT_ID,
              content: { membership: 'join', displayname: 'Agent' },
            },
          ];
          json(200, {
            next_batch: String(events.length),
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
          return;
        }
        const delta = events.slice(since);
        json(200, {
          next_batch: String(events.length),
          rooms: delta.length
            ? {
                join: {
                  [ROOM_ID]: {
                    state: { events: [] },
                    timeline: { events: delta, limited: false },
                    ephemeral: { events: [] },
                    account_data: { events: [] },
                  },
                },
              }
            : { join: {} },
        });
      };

      if (since === 0 || events.length > since) {
        answer();
        return;
      }
      const timer = setTimeout(answer, 1_500);
      const wake = () => {
        clearTimeout(timer);
        answer();
      };
      waiters.push(wake);
      req.on('close', () => {
        clearTimeout(timer);
        const idx = waiters.indexOf(wake);
        if (idx >= 0) waiters.splice(idx, 1);
      });
      return;
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
    pushEvent: (event: MatrixEventJson) => {
      events.push(event);
      notify();
    },
    probeHits: () => probeHits,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

const buildInteractiveCanvasHtml = (label: string, probeUrl: string): string => `
<div id="root">
  <div id="label">${label}</div>
  <div id="count">0</div>
  <div id="saved"></div>
  <div id="remote"></div>
  <button id="inc" type="button">Increment</button>
  <button id="save" type="button">Save State</button>
  <button id="escape-inner" type="button">Escape Inner</button>
  <div id="bars"></div>
  <pre id="meta">pending</pre>
</div>
<script>
  let n = 0;
  const countEl = document.getElementById('count');
  document.getElementById('saved').textContent = (window.mindroom && window.mindroom.state && window.mindroom.state.note) || 'none';
  const metaCsp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  document.getElementById('remote').textContent = metaCsp && metaCsp.content.includes('img-src data: blob: https:') ? 'on' : 'off';
  document.getElementById('inc').addEventListener('click', () => {
    n += 1;
    countEl.textContent = String(n);
  });
  document.getElementById('save').addEventListener('click', () => {
    window.mindroom.saveState({ note: 'same-rev-saved' });
  });
  document.getElementById('escape-inner').addEventListener('click', () => {
    window.location.assign('about:blank');
  });
  let d3Ok = false;
  try {
    d3.select('#bars').append('svg').attr('width', 40).attr('height', 12)
      .append('rect').attr('width', 30).attr('height', 10);
    d3Ok = document.querySelectorAll('#bars rect').length === 1;
  } catch {}
  let fetchBlocked = false;
  fetch(${JSON.stringify(probeUrl)})
    .then(() => { fetchBlocked = false; })
    .catch(() => { fetchBlocked = true; })
    .finally(() => {
      document.getElementById('meta').textContent = JSON.stringify({
        origin: window.origin,
        hasBridge: 'mindroomDesktop' in window,
        d3Ok,
        fetchBlocked,
      });
    });
</script>`;

test.describe('Electron script policy and canvas frame', () => {
  test('serves combined framing and script CSP headers for /connect, /invite, /home, and /canvas-frame.html', async () => {
    const session = await launchDesktop({ offline: true });
    try {
      const { page } = session;
      await expect(page.locator('input[name="serverInput"]')).toBeVisible();

      const responses = await page.evaluate(async () => {
        const paths = ['/connect', '/CONNECT', '/invite', '/INVITE', '/home'];
        const out: Record<string, { csp: string | null; xfo: string | null }> = {};
        for (const p of paths) {
          const res = await fetch(p);
          out[p] = {
            csp: res.headers.get('content-security-policy'),
            xfo: res.headers.get('x-frame-options'),
          };
        }
        let canvasFetchBlocked = false;
        try {
          await fetch('/canvas-frame.html');
        } catch {
          canvasFetchBlocked = true;
        }
        return { out, canvasFetchBlocked };
      });

      for (const unframeable of ['/connect', '/CONNECT', '/invite', '/INVITE']) {
        const { csp, xfo } = responses.out[unframeable]!;
        expect(xfo, unframeable).toBe('DENY');
        expect(csp, unframeable).toContain("frame-ancestors 'none'");
        expect(csp, unframeable).toContain("script-src 'self'");
        expect(csp, unframeable).toContain("'wasm-unsafe-eval'");
        expect(csp, unframeable).toContain("worker-src 'self' blob:");
        expect(csp, unframeable).not.toContain("'unsafe-inline'");
        expect(csp, unframeable).not.toContain("'unsafe-eval'");
      }

      const home = responses.out['/home']!;
      expect(home.xfo).toBe('SAMEORIGIN');
      expect(home.csp).toContain("frame-ancestors 'self'");
      expect(home.csp).toContain("script-src 'self'");
      expect(home.csp).toContain("'wasm-unsafe-eval'");
      expect(home.csp).toContain("worker-src 'self' blob:");
      expect(home.csp).not.toContain("'unsafe-inline'");
      expect(home.csp).not.toContain("'unsafe-eval'");
      // Non-subFrame fetches to /canvas-frame.html are cancelled by guardSession.
      expect(responses.canvasFetchBlocked).toBe(true);
    } finally {
      await session.close();
    }
  });

  test('blocks untrusted scripts and eval with CSP violations, and renders a PDF inside /pdf-frame.html', async () => {
    const session = await launchDesktop({ offline: true });
    try {
      const { page, expectViolations } = session;
      await expect(page.locator('input[name="serverInput"]')).toBeVisible();

      const caught = await expectViolations(async () => {
        const results = await page.evaluate(async () => {
          const w = window as unknown as { __pwn?: string[] };
          w.__pwn = [];

          // 1. <script> added from a string
          const inline = document.createElement('script');
          inline.textContent = "window.__pwn.push('inline');";
          document.head.append(inline);

          // 2. <img onerror>
          const host = document.createElement('div');
          host.innerHTML = `<img src="capacitor://localhost/assets/missing.png" onerror="window.__pwn.push('onerror')">`;
          document.body.append(host);

          // 3. Remote script from https://example.org
          const remote = document.createElement('script');
          remote.src = 'https://example.org/pwn.js';
          document.head.append(remote);

          // 4. eval('1') outside DevTools Runtime.evaluate's inspector CSP bypass.
          const evalBlocked = await new Promise<boolean>((resolve) => {
            setTimeout(() => {
              try {
                // eslint-disable-next-line no-eval
                eval('1');
                resolve(false);
              } catch {
                resolve(true);
              }
            }, 0);
          });

          await new Promise((resolve) => setTimeout(resolve, 150));
          inline.remove();
          host.remove();
          remote.remove();
          return { pwn: w.__pwn, evalBlocked };
        });
        expect(results).toEqual({ pwn: [], evalBlocked: true });
      });

      expect(caught.length).toBeGreaterThanOrEqual(4);
      expect(caught.some((v) => v.includes('script-src-elem') && v.includes('inline'))).toBe(true);
      expect(caught.some((v) => v.includes('script-src-attr'))).toBe(true);
      expect(caught.some((v) => v.includes('https://example.org/pwn.js'))).toBe(true);
      expect(caught.some((v) => v.includes('eval'))).toBe(true);
      expect(session.violations).toEqual([]);

      // PDF frame opens a PDF blob into an <embed type="application/pdf"> with zero violations.
      const pdfEmbed = await page.evaluate(async (pdfText: string) => {
        const blobUrl = URL.createObjectURL(new Blob([pdfText], { type: 'application/pdf' }));
        const frame = document.createElement('iframe');
        frame.src = `/pdf-frame.html#${encodeURIComponent(blobUrl)}`;
        document.body.append(frame);
        const embedSrc = await new Promise<string | null>((resolve) => {
          const deadline = Date.now() + 5_000;
          const poll = () => {
            const embed = frame.contentDocument?.querySelector('embed[type="application/pdf"]');
            const src = embed?.getAttribute('src') ?? null;
            if (src) {
              resolve(src);
              return;
            }
            if (Date.now() > deadline) {
              resolve(null);
              return;
            }
            setTimeout(poll, 25);
          };
          poll();
        });
        frame.remove();
        URL.revokeObjectURL(blobUrl);
        return embedSrc;
      }, MINIMAL_PDF);
      expect(pdfEmbed).toMatch(/^blob:capacitor:\/\/localhost\//);
    } finally {
      await session.close();
    }
  });

  test('blocks /canvas-frame.html as main frame and sandboxes it even without a sandbox attribute', async () => {
    const session = await launchDesktop({ offline: true });
    try {
      const { app, page } = session;
      await expect(page.locator('input[name="serverInput"]')).toBeVisible();

      const spellings = [
        '/canvas-frame.html',
        '/CANVAS-FRAME.HTML',
        '/canvas-frame%2ehtml',
        '/%63anvas-frame.html',
        '//canvas-frame.html',
        '/canvas-frame.html/',
        '/canvas-frame.html?x=1',
      ];
      for (const targetPath of spellings) {
        await page.evaluate((target: string) => {
          window.location.assign(target);
        }, `${APP_ORIGIN}${targetPath}`);
        await page.waitForTimeout(150);
        await page.waitForLoadState('domcontentloaded');
        const state = await page.evaluate(() => ({
          origin: window.location.origin,
          title: document.title,
          hasRobotsNoIndex: document.querySelector('meta[name="robots"]') !== null,
        }));
        expect(state.origin, targetPath).toBe(APP_ORIGIN);
        expect(state.title, targetPath).not.toBe('Canvas');
        expect(state.hasRobotsNoIndex, targetPath).toBe(false);
      }

      for (const directUrl of [
        `${APP_ORIGIN}/canvas-frame.html`,
        `${APP_ORIGIN}/%63anvas-frame%2ehtml`,
      ]) {
        const result = await app.evaluate(async ({ BrowserWindow }, target: string) => {
          const win = BrowserWindow.getAllWindows()[0];
          if (!win) return { rejected: false, code: '' };
          try {
            await win.loadURL(target);
            return { rejected: false, code: '' };
          } catch (err) {
            return { rejected: true, code: String((err as { code?: unknown }).code ?? '') };
          }
        }, directUrl);
        expect(result, directUrl).toEqual({ rejected: true, code: 'ERR_BLOCKED_BY_CLIENT' });
      }

      // Return to root and embed /canvas-frame.html WITHOUT a sandbox attribute.
      await page.goto(`${APP_ORIGIN}/`);
      await expect(page.locator('input[name="serverInput"]')).toBeVisible();

      const unsandboxedResult = await page.evaluate(async () => {
        const frame = document.createElement('iframe');
        // Deliberately NO sandbox attribute: CANVAS_FRAME_POLICY header must still sandbox it.
        const result = new Promise<{ origin: string; hasBridge: boolean; messageOrigin: string }>(
          (resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error('canvas-frame probe timed out')),
              5_000
            );
            const onMessage = (event: MessageEvent) => {
              if (event.source !== frame.contentWindow) return;
              if (event.data === 'canvas-frame-ready') {
                frame.contentWindow?.postMessage(
                  `<!doctype html><script>window.parent.postMessage({ type: 'probe', origin: window.origin, hasBridge: 'mindroomDesktop' in window }, 'capacitor://localhost');</script>`,
                  '*'
                );
                return;
              }
              if (event.data?.type === 'probe') {
                clearTimeout(timer);
                window.removeEventListener('message', onMessage);
                resolve({
                  origin: event.data.origin,
                  hasBridge: event.data.hasBridge,
                  messageOrigin: event.origin,
                });
              }
            };
            window.addEventListener('message', onMessage);
          }
        );
        frame.src = '/canvas-frame.html';
        document.body.append(frame);
        const value = await result;
        frame.remove();
        return value;
      });
      expect(unsandboxedResult).toEqual({
        origin: 'null',
        hasBridge: false,
        messageOrigin: 'null',
      });
    } finally {
      await session.close();
    }
  });

  test('runs canvases inline and in the panel with scripts, pinned libraries, escapes, and document updates', async () => {
    const now = Date.now();
    const mock = await startMockMatrixServer([]);
    const probeUrl = `${mock.baseUrl}/canvas-probe`;
    mock.pushEvent({
      type: 'm.room.message',
      event_id: ROOT_ID,
      sender: USER_ID,
      origin_server_ts: now - 5_000,
      room_id: ROOM_ID,
      content: { msgtype: 'm.text', body: 'Start canvas thread' },
    });
    mock.pushEvent({
      type: 'm.room.message',
      event_id: '$canvas1',
      sender: AGENT_ID,
      origin_server_ts: now - 2_000,
      room_id: ROOM_ID,
      content: {
        msgtype: 'm.notice',
        body: 'Interactive panel: Policy Canvas. Open it in MindRoom Chat to respond.',
        'm.relates_to': { rel_type: 'm.thread', event_id: ROOT_ID },
        'io.mindroom.ui_action': {
          version: 1,
          action: 'show_canvas',
          requester_id: USER_ID,
          agent_user_id: AGENT_ID,
          room_id: ROOM_ID,
          thread_id: ROOT_ID,
          inline: true,
          canvas: {
            title: 'Policy Canvas',
            html: buildInteractiveCanvasHtml('v1-inline', probeUrl),
            libraries: ['d3'],
          },
        },
      },
    });

    const session = await launchDesktop();
    try {
      const { page } = session;
      const setup = page.getByRole('dialog').filter({ hasText: 'Set up your recovery password' });
      await page.addLocatorHandler(setup, () =>
        setup.getByRole('button', { name: 'Not now' }).click()
      );
      const tourDismiss = page.locator('[data-tour-offer-action="dismiss"]');
      await page.addLocatorHandler(tourDismiss, () => tourDismiss.click());
      await expect(page.locator('input[name="serverInput"]')).toBeVisible();

      await page.evaluate(
        ({ baseUrl, userId }: { baseUrl: string; userId: string }) => {
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
        { baseUrl: mock.baseUrl, userId: USER_ID }
      );

      await page.goto(
        `${APP_ORIGIN}/home/${encodeURIComponent(ROOM_ID)}?threadId=${encodeURIComponent(ROOT_ID)}`
      );

      const assertCanvasWorks = async (
        outerSelector: string,
        expectedLabel: string
      ): Promise<FrameLocator> => {
        const outer = page.locator(outerSelector).first();
        await expect(outer).toBeVisible({ timeout: 20_000 });
        await expect(outer).toHaveAttribute('src', '/canvas-frame.html');
        const inner = page.frameLocator(outerSelector).first().frameLocator('iframe');
        await expect(inner.locator('#label')).toHaveText(expectedLabel, { timeout: 15_000 });
        await expect(inner.locator('#meta')).toHaveText(
          JSON.stringify({ origin: 'null', hasBridge: false, d3Ok: true, fetchBlocked: true }),
          { timeout: 15_000 }
        );
        await expect(inner.locator('#count')).toHaveText('0');
        await inner.locator('#inc').click();
        await expect(inner.locator('#count')).toHaveText('1');
        return inner;
      };

      // 1. Inline canvas works with script, button, pinned d3, opaque origin, no bridge, fetch refused.
      const inlineInner = await assertCanvasWorks('iframe[title="Policy Canvas"]', 'v1-inline');
      expect(mock.probeHits()).toBe(0);

      await expect(inlineInner.locator('#remote')).toHaveText('off');
      await expect(inlineInner.locator('#saved')).toHaveText('none');

      // 2a. Navigating the wrapper frame itself restarts the inline canvas with the same document and runs again.
      await page
        .locator('iframe[title="Policy Canvas"]')
        .first()
        .contentFrame()
        .locator('body')
        .evaluate(() => {
          window.location.assign('about:blank');
        });
      await expect(inlineInner.locator('#count')).toHaveText('0', { timeout: 15_000 });
      await inlineInner.locator('#inc').click();
      await expect(inlineInner.locator('#count')).toHaveText('1');
      await expect(inlineInner.locator('#meta')).toHaveText(
        JSON.stringify({ origin: 'null', hasBridge: false, d3Ok: true, fetchBlocked: true })
      );

      // 2b. Saving state and escaping changes the document within one revision (same revisionEventId) and shows it.
      await inlineInner.locator('#save').click();
      await inlineInner.locator('#escape-inner').click();
      await expect(inlineInner.locator('#saved')).toHaveText('same-rev-saved', { timeout: 15_000 });
      await expect(inlineInner.locator('#count')).toHaveText('0');
      await inlineInner.locator('#inc').click();
      await expect(inlineInner.locator('#count')).toHaveText('1');

      // 3. Updating the canvas document replaces the shown inline canvas.
      mock.pushEvent({
        type: 'm.room.message',
        event_id: '$canvas1_v2',
        sender: AGENT_ID,
        origin_server_ts: Date.now(),
        room_id: ROOM_ID,
        content: {
          msgtype: 'm.notice',
          body: '* Interactive panel: Policy Canvas.',
          'm.relates_to': { rel_type: 'm.replace', event_id: '$canvas1' },
          'm.new_content': {
            msgtype: 'm.notice',
            body: 'Interactive panel: Policy Canvas.',
            'io.mindroom.ui_action': {
              version: 1,
              action: 'show_canvas',
              requester_id: USER_ID,
              agent_user_id: AGENT_ID,
              room_id: ROOM_ID,
              thread_id: ROOT_ID,
              inline: true,
              canvas: {
                title: 'Policy Canvas',
                html: buildInteractiveCanvasHtml('v2-updated', probeUrl),
                libraries: ['d3'],
              },
            },
          },
        },
      });
      const loadInlineUpdate = page
        .getByRole('button', { name: 'Load update', exact: true })
        .first();
      await expect(loadInlineUpdate).toBeVisible({ timeout: 15_000 });
      await loadInlineUpdate.click();
      await assertCanvasWorks('iframe[title="Policy Canvas"]', 'v2-updated');

      // 4. Open in the panel: works, updates on a new document, and shows escaped after a document change.
      await page.getByRole('button', { name: 'Open canvas', exact: true }).last().click();
      const panel = page
        .locator('aside[aria-label*="Canvas"], aside[aria-label*="canvas"]')
        .first();
      await expect(panel).toBeVisible({ timeout: 20_000 });
      await assertCanvasWorks('aside iframe[title="Policy Canvas"]', 'v2-updated');

      mock.pushEvent({
        type: 'm.room.message',
        event_id: '$canvas1_v3',
        sender: AGENT_ID,
        origin_server_ts: Date.now(),
        room_id: ROOM_ID,
        content: {
          msgtype: 'm.notice',
          body: '* Interactive panel: Policy Canvas.',
          'm.relates_to': { rel_type: 'm.replace', event_id: '$canvas1' },
          'm.new_content': {
            msgtype: 'm.notice',
            body: 'Interactive panel: Policy Canvas.',
            'io.mindroom.ui_action': {
              version: 1,
              action: 'show_canvas',
              requester_id: USER_ID,
              agent_user_id: AGENT_ID,
              room_id: ROOM_ID,
              thread_id: ROOT_ID,
              inline: true,
              canvas: {
                title: 'Policy Canvas',
                html: buildInteractiveCanvasHtml('v3-panel', probeUrl),
                libraries: ['d3'],
              },
            },
          },
        },
      });
      const loadPanelUpdate = panel.getByRole('button', { name: 'Load update', exact: true });
      await expect(loadPanelUpdate).toBeVisible({ timeout: 15_000 });
      await loadPanelUpdate.click();
      await assertCanvasWorks('aside iframe[title="Policy Canvas"]', 'v3-panel');

      // Escape the wrapper frame in the panel after the document change -> shown as escaped.
      await page
        .locator('aside iframe[title="Policy Canvas"]')
        .first()
        .contentFrame()
        .locator('body')
        .evaluate(() => {
          window.location.assign('about:blank');
        });
      await expect(panel.getByRole('alert').filter({ hasText: /tried to leave/i })).toBeVisible({
        timeout: 15_000,
      });
      expect(mock.probeHits()).toBe(0);
    } finally {
      await session.close();
      await mock.close();
    }
  });

  test('allows remote assets in the canvas frame when remoteAssets is enabled in config', async () => {
    const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), 'mindroom-remote-dist-'));
    copyDir(path.join(ROOT, 'dist'), tmpDist);
    const configPath = path.join(tmpDist, 'config.json');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const mindroom = (cfg.mindroom as Record<string, unknown> | undefined) ?? {};
    cfg.mindroom = { ...mindroom, canvas: { enabled: true, remoteAssets: true } };
    fs.rmSync(configPath);
    fs.writeFileSync(configPath, JSON.stringify(cfg), 'utf8');

    const now = Date.now();
    const mock = await startMockMatrixServer([
      {
        type: 'm.room.message',
        event_id: ROOT_ID,
        sender: USER_ID,
        origin_server_ts: now - 5_000,
        room_id: ROOM_ID,
        content: { msgtype: 'm.text', body: 'Remote assets thread' },
      },
      {
        type: 'm.room.message',
        event_id: '$remote1',
        sender: AGENT_ID,
        origin_server_ts: now - 2_000,
        room_id: ROOM_ID,
        content: {
          msgtype: 'm.notice',
          body: 'Interactive panel: Remote Canvas.',
          'm.relates_to': { rel_type: 'm.thread', event_id: ROOT_ID },
          'io.mindroom.ui_action': {
            version: 1,
            action: 'show_canvas',
            requester_id: USER_ID,
            agent_user_id: AGENT_ID,
            room_id: ROOM_ID,
            thread_id: ROOT_ID,
            inline: true,
            canvas: {
              title: 'Remote Canvas',
              html: buildInteractiveCanvasHtml('remote-on', 'http://127.0.0.1:1/blocked'),
              libraries: ['d3'],
            },
          },
        },
      },
    ]);
    const session = await launchDesktop({ dist: tmpDist });
    try {
      const { page } = session;
      const setup = page.getByRole('dialog').filter({ hasText: 'Set up your recovery password' });
      await page.addLocatorHandler(setup, () =>
        setup.getByRole('button', { name: 'Not now' }).click()
      );
      const tourDismiss = page.locator('[data-tour-offer-action="dismiss"]');
      await page.addLocatorHandler(tourDismiss, () => tourDismiss.click());
      await expect(page.locator('input[name="serverInput"]')).toBeVisible();
      await page.evaluate(
        ({ baseUrl, userId }: { baseUrl: string; userId: string }) => {
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
        { baseUrl: mock.baseUrl, userId: USER_ID }
      );
      await page.goto(
        `${APP_ORIGIN}/home/${encodeURIComponent(ROOM_ID)}?threadId=${encodeURIComponent(ROOT_ID)}`
      );
      const inner = page
        .frameLocator('iframe[title="Remote Canvas"]')
        .first()
        .frameLocator('iframe');
      await expect(inner.locator('#remote')).toHaveText('on', { timeout: 20_000 });
      await expect(inner.locator('#meta')).toHaveText(
        JSON.stringify({ origin: 'null', hasBridge: false, d3Ok: true, fetchBlocked: true }),
        { timeout: 15_000 }
      );
    } finally {
      await session.close();
      await mock.close();
      fs.rmSync(tmpDist, { recursive: true, force: true });
    }
  });
});
