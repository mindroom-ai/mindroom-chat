import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type FrameLocator } from '@playwright/test';
import { assertNoUnexpectedViolations, launchDesktop } from '../helpers/electronApp';
import { startMockMatrixServer } from '../helpers/mockMatrixServer';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REMOTE_ASSET_URL = 'https://assets.example.test/pixel.png';
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

const copyDir = (src: string, dest: string): void => {
  fs.cpSync(src, dest, { recursive: true });
};

const APP_ORIGIN = 'capacitor://localhost';
const USER_ID = '@e2e:localhost';
const AGENT_ID = '@mindroom_agent:localhost';
const ROOM_ID = '!canvas:localhost';
const ROOT_ID = '$root';

/** Builds a valid one-page PDF with exact cross-reference offsets. */
const buildOnePagePdf = (text: string): string => {
  const stream = `BT /F1 16 Tf 56 720 Td (${text}) Tj ET`;
  const objects = [
    '',
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, id) => {
    if (id === 0) return 0;
    const offset = pdf.length;
    pdf += `${id} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
};

const MINIMAL_PDF = buildOnePagePdf('MindRoom Electron PDF check');

const buildInteractiveCanvasHtml = (label: string, probeUrl: string): string => `
<div id="root">
  <div id="label">${label}</div>
  <div id="count">0</div>
  <div id="saved"></div>
  <div id="remote"></div>
  <div id="remote-asset">pending</div>
  <img id="remote-img" alt="" />
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
  const remoteImg = document.getElementById('remote-img');
  remoteImg.addEventListener('load', () => {
    document.getElementById('remote-asset').textContent = 'loaded:' + remoteImg.naturalWidth;
  });
  remoteImg.addEventListener('error', () => {
    document.getElementById('remote-asset').textContent = 'blocked';
  });
  remoteImg.src = ${JSON.stringify(REMOTE_ASSET_URL)};
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
  test.afterEach(() => assertNoUnexpectedViolations());

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
        expect(csp, unframeable).toContain("script-src 'self' 'wasm-unsafe-eval'");
        expect(csp, unframeable).not.toContain('sha256-');
        expect(csp, unframeable).toContain("'wasm-unsafe-eval'");
        expect(csp, unframeable).toContain("worker-src 'self' blob:");
        expect(csp, unframeable).not.toContain("'unsafe-inline'");
        expect(csp, unframeable).not.toContain("'unsafe-eval'");
      }

      const home = responses.out['/home']!;
      expect(home.xfo).toBe('SAMEORIGIN');
      expect(home.csp).toContain("frame-ancestors 'self'");
      expect(home.csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
      expect(home.csp).not.toContain('sha256-');
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

      expect([...caught].sort()).toEqual(
        [
          'script-src-elem: inline',
          'script-src-attr: inline',
          'script-src-elem: https://example.org/pwn.js',
          'script-src: eval',
        ].sort()
      );
      expect(session.violations).toEqual([]);

      // PDF frame runs its external loader script with zero CSP violations inside /pdf-frame.html
      // and mounts a sized PDF <embed>. Chromium's PDFium plugin internals are not inspectable via
      // DOM; visual viewer rendering is verified by screenshot on the M2.
      const pdfViolations: string[] = [];
      await page.exposeBinding('__mindroomPdfCsp', ({ frame }, detail: string) => {
        if (frame.url().includes('/pdf-frame.html')) pdfViolations.push(detail);
      });
      await page.addInitScript(() => {
        if (!window.location.pathname.endsWith('/pdf-frame.html')) return;
        window.addEventListener(
          'securitypolicyviolation',
          (event) => {
            const fn = (window as unknown as { __mindroomPdfCsp?: (detail: string) => void })
              .__mindroomPdfCsp;
            fn?.(
              `${event.effectiveDirective || event.violatedDirective}: ${
                event.blockedURI || 'inline'
              }`
            );
          },
          true
        );
      });
      const pdfResult = await page.evaluate(async (pdfText: string) => {
        const blobUrl = URL.createObjectURL(new Blob([pdfText], { type: 'application/pdf' }));
        const frame = document.createElement('iframe');
        frame.id = 'e2e-pdf-frame';
        frame.style.cssText = 'width:320px;height:240px;';
        frame.src = `/pdf-frame.html#${encodeURIComponent(blobUrl)}`;
        document.body.append(frame);
        const info = await new Promise<{ src: string | null; width: number; height: number }>(
          (resolve) => {
            const deadline = Date.now() + 5_000;
            const poll = () => {
              const embed = frame.contentDocument?.querySelector('embed[type="application/pdf"]');
              const src = embed?.getAttribute('src') ?? null;
              if (embed && src) {
                const rect = embed.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  resolve({ src, width: rect.width, height: rect.height });
                  return;
                }
              }
              if (Date.now() > deadline) {
                resolve({ src, width: 0, height: 0 });
                return;
              }
              setTimeout(poll, 25);
            };
            poll();
          }
        );
        return { ...info, blobUrl };
      }, MINIMAL_PDF);
      // Wait for Chromium's built-in PDF viewer extension frame to attach inside the <embed>.
      await expect
        .poll(() => page.frames().some((frame) => frame.url().startsWith('chrome-extension://')), {
          timeout: 10_000,
        })
        .toBe(true);
      await page.evaluate((blobUrl: string) => {
        document.getElementById('e2e-pdf-frame')?.remove();
        URL.revokeObjectURL(blobUrl);
      }, pdfResult.blobUrl);
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(pdfViolations).toEqual([]);
      expect(pdfResult.src).toMatch(/^blob:capacitor:\/\/localhost\//);
      expect(pdfResult.width).toBeGreaterThan(0);
      expect(pdfResult.height).toBeGreaterThan(0);
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

      // Embed /canvas-frame.html WITHOUT a sandbox attribute while still on APP_ORIGIN.
      const unsandboxedResult = await page.evaluate(async () => {
        const frame = document.createElement('iframe');
        // Deliberately NO sandbox attribute: CANVAS_FRAME_POLICY header must still sandbox it.
        const result = new Promise<{
          origin: string;
          hasBridge: boolean;
          parentBlocked: boolean;
          messageOrigin: string;
        }>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('canvas-frame probe timed out')), 5_000);
          const onMessage = (event: MessageEvent) => {
            if (event.source !== frame.contentWindow) return;
            if (event.data === 'canvas-frame-ready') {
              frame.contentWindow?.postMessage(
                `<!doctype html><script>
                    let parentBlocked = false;
                    try { void window.parent.mindroomDesktop; } catch { parentBlocked = true; }
                    window.parent.postMessage({ type: 'probe', origin: window.origin, hasBridge: 'mindroomDesktop' in window, parentBlocked }, 'capacitor://localhost');
                  </script>`,
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
                parentBlocked: event.data.parentBlocked,
                messageOrigin: event.origin,
              });
            }
          };
          window.addEventListener('message', onMessage);
        });
        frame.src = '/canvas-frame.html';
        document.body.append(frame);
        const value = await result;
        frame.remove();
        return value;
      });
      expect(unsandboxedResult).toEqual({
        origin: 'null',
        hasBridge: false,
        parentBlocked: true,
        messageOrigin: 'null',
      });

      // Run direct main-process loadURL blocks last: ERR_BLOCKED_BY_CLIENT triggers an async
      // chrome-error://chromewebdata/ commit that can interrupt a subsequent page.goto.
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
    let remoteAssetHits = 0;
    try {
      const { page } = session;
      await page.context().route(REMOTE_ASSET_URL, (route) => {
        remoteAssetHits += 1;
        return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG });
      });
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

      const canvasAlert = (outerSelector: string) =>
        outerSelector.startsWith('aside ')
          ? page
              .locator('aside[aria-label*="Canvas"], aside[aria-label*="canvas"]')
              .first()
              .getByRole('alert')
              .first()
          : page.locator(outerSelector).first().locator('xpath=../..').getByRole('alert').first();

      const markBeforeRemount = async (outerSelector: string): Promise<void> => {
        await page
          .locator(outerSelector)
          .first()
          .evaluate((el) => {
            el.setAttribute('data-e2e-prev', '1');
          });
        await canvasAlert(outerSelector).evaluate((el) => {
          el.setAttribute('data-e2e-prev', '1');
        });
      };

      const waitForSettledCanvas = async (
        outerSelector: string,
        expectedLabel: string,
        remounted = false
      ): Promise<FrameLocator> => {
        const outer = page.locator(outerSelector).first();
        await expect(outer).toBeVisible({ timeout: 20_000 });
        if (remounted) {
          await expect(outer).not.toHaveAttribute('data-e2e-prev', '1', { timeout: 15_000 });
        }
        await expect(outer).toHaveAttribute('src', '/canvas-frame.html');
        const inner = page.frameLocator(outerSelector).first().frameLocator('iframe');
        await expect(inner.locator('#label')).toHaveText(expectedLabel, { timeout: 15_000 });
        await expect(inner.locator('#meta')).toHaveText(
          JSON.stringify({ origin: 'null', hasBridge: false, d3Ok: true, fetchBlocked: true }),
          { timeout: 15_000 }
        );
        await expect(inner.locator('#remote-asset')).toHaveText('blocked', { timeout: 15_000 });
        // CanvasPageErrors mounts above the iframe once both blocked CSP reports arrive,
        // shifting the iframe down; wait for the new alert to settle before clicking inside.
        const alert = canvasAlert(outerSelector);
        await expect(alert).toBeVisible({ timeout: 15_000 });
        if (remounted) {
          await expect(alert).not.toHaveAttribute('data-e2e-prev', '1', { timeout: 15_000 });
        }
        await expect(alert).toContainText('(connect-src)', { timeout: 15_000 });
        await expect(alert).toContainText('(img-src)', { timeout: 15_000 });
        // After a remount the inline canvas resizes via postMessage and timeline layout can shift
        // the outer iframe while #inc looks stationary inside its own inner frame. Wait until the
        // outer iframe rect is unchanged across two animation frames and #inc is under the click point.
        await inner.locator('#inc').scrollIntoViewIfNeeded();
        await expect
          .poll(
            async () => {
              const stableOuter = await outer.evaluate(
                (el) =>
                  new Promise<boolean>((resolve) => {
                    const read = () => {
                      const r = el.getBoundingClientRect();
                      return [
                        Math.round(r.left),
                        Math.round(r.top),
                        Math.round(r.width),
                        Math.round(r.height),
                      ] as const;
                    };
                    requestAnimationFrame(() => {
                      const a = read();
                      requestAnimationFrame(() => {
                        const b = read();
                        resolve(
                          a[2] > 0 &&
                            a[3] > 0 &&
                            a[0] === b[0] &&
                            a[1] === b[1] &&
                            a[2] === b[2] &&
                            a[3] === b[3]
                        );
                      });
                    });
                  })
              );
              if (!stableOuter) return false;
              const incPoint = await inner.locator('#inc').evaluate((el) => {
                const r = el.getBoundingClientRect();
                const cx = r.left + r.width / 2;
                const cy = r.top + r.height / 2;
                const hit = document.elementFromPoint(cx, cy);
                return r.width > 0 &&
                  r.height > 0 &&
                  (hit === el || (hit !== null && el.contains(hit)))
                  ? { cx, cy }
                  : null;
              });
              if (!incPoint) return false;
              const innerOffset = await page
                .frameLocator(outerSelector)
                .first()
                .locator('iframe')
                .evaluate((el) => {
                  const r = el.getBoundingClientRect();
                  return { left: r.left, top: r.top };
                });
              return outer.evaluate(
                (el, pt) => {
                  const r = el.getBoundingClientRect();
                  return document.elementFromPoint(r.left + pt.x, r.top + pt.y) === el;
                },
                { x: innerOffset.left + incPoint.cx, y: innerOffset.top + incPoint.cy }
              );
            },
            { timeout: 15_000 }
          )
          .toBe(true);
        return inner;
      };

      const assertCanvasWorks = async (
        outerSelector: string,
        expectedLabel: string,
        remounted = false
      ): Promise<FrameLocator> => {
        const inner = await waitForSettledCanvas(outerSelector, expectedLabel, remounted);
        await expect(inner.locator('#count')).toHaveText('0');
        await inner.locator('#inc').click();
        await expect(inner.locator('#count')).toHaveText('1');
        return inner;
      };

      // 1. Inline canvas works with script, button, pinned d3, opaque origin, no bridge, fetch refused.
      const inlineInner = await assertCanvasWorks('iframe[title="Policy Canvas"]', 'v1-inline');
      expect(mock.probeHits()).toBe(0);

      await expect(inlineInner.locator('#remote')).toHaveText('off');
      expect(remoteAssetHits).toBe(0);
      await expect(inlineInner.locator('#saved')).toHaveText('none');

      // 2a. Navigating the wrapper frame itself restarts the inline canvas with the same document and runs again.
      await markBeforeRemount('iframe[title="Policy Canvas"]');
      await page
        .locator('iframe[title="Policy Canvas"]')
        .first()
        .contentFrame()
        .locator('body')
        .evaluate(() => {
          window.location.assign('about:blank');
        });
      await assertCanvasWorks('iframe[title="Policy Canvas"]', 'v1-inline', true);

      // 2b. Saving state and escaping changes the document within one revision (same revisionEventId) and shows it.
      await inlineInner.locator('#save').click();
      await markBeforeRemount('iframe[title="Policy Canvas"]');
      await inlineInner.locator('#escape-inner').click();
      await waitForSettledCanvas('iframe[title="Policy Canvas"]', 'v1-inline', true);
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
      await markBeforeRemount('iframe[title="Policy Canvas"]');
      await loadInlineUpdate.click();
      await assertCanvasWorks('iframe[title="Policy Canvas"]', 'v2-updated', true);

      // 4. Open in the panel: works, updates on a new document, and shows escaped after a document change.
      await page.getByRole('button', { name: 'Open canvas', exact: true }).last().click();
      const panel = page
        .locator('aside[aria-label*="Canvas"], aside[aria-label*="canvas"]')
        .first();
      await expect(panel).toBeVisible({ timeout: 20_000 });
      // Wait for ResizablePanel's 220ms width-opening animation so clicks inside the nested
      // opaque iframe do not land while the panel is shifting horizontally.
      await panel.evaluate((el) =>
        Promise.all((el.closest('[data-side]') ?? el).getAnimations().map((a) => a.finished))
      );
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
      await markBeforeRemount('aside iframe[title="Policy Canvas"]');
      await loadPanelUpdate.click();
      await assertCanvasWorks('aside iframe[title="Policy Canvas"]', 'v3-panel', true);

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
    let remoteAssetHits = 0;
    try {
      const { page } = session;
      await page.context().route(REMOTE_ASSET_URL, (route) => {
        remoteAssetHits += 1;
        return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG });
      });
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
      await expect(inner.locator('#remote-asset')).toHaveText('loaded:1', { timeout: 15_000 });
      expect(remoteAssetHits).toBeGreaterThanOrEqual(1);
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

  test('remounts an already-mounted inline canvas and loads the remote asset when remoteAssets flips live', async () => {
    const now = Date.now();
    const mock = await startMockMatrixServer([
      {
        type: 'm.room.message',
        event_id: ROOT_ID,
        sender: USER_ID,
        origin_server_ts: now - 5_000,
        room_id: ROOM_ID,
        content: { msgtype: 'm.text', body: 'Live remote flip thread' },
      },
      {
        type: 'm.room.message',
        event_id: '$liveRemote1',
        sender: AGENT_ID,
        origin_server_ts: now - 2_000,
        room_id: ROOM_ID,
        content: {
          msgtype: 'm.notice',
          body: 'Interactive panel: Live Remote Canvas.',
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
              title: 'Live Remote Canvas',
              html: buildInteractiveCanvasHtml('live-remote', 'http://127.0.0.1:1/blocked'),
              libraries: ['d3'],
            },
          },
        },
      },
    ]);
    const session = await launchDesktop();
    let remoteAssetHits = 0;
    try {
      const { page } = session;
      await page.context().route(REMOTE_ASSET_URL, (route) => {
        remoteAssetHits += 1;
        return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG });
      });
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
      const outer = page.locator('iframe[title="Live Remote Canvas"]').first();
      const inner = page
        .frameLocator('iframe[title="Live Remote Canvas"]')
        .first()
        .frameLocator('iframe');
      await expect(outer).toBeVisible({ timeout: 20_000 });
      await expect(inner.locator('#remote')).toHaveText('off', { timeout: 15_000 });
      await expect(inner.locator('#remote-asset')).toHaveText('blocked', { timeout: 15_000 });
      expect(remoteAssetHits).toBe(0);

      // Flip remoteAssets on the live mounted ClientConfigLoader (same canvas revision, no reload).
      const flipped = await page.evaluate(() => {
        const el = document.querySelector('iframe[title="Live Remote Canvas"]');
        if (!el) return false;
        (window as unknown as { __beforeFlipFrame?: Element }).__beforeFlipFrame = el;
        const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
        if (!fiberKey) return false;
        type Hook = {
          memoizedState?: unknown;
          queue?: { dispatch?: (v: unknown) => void };
          next?: Hook;
        };
        type Fiber = { return?: Fiber | null; memoizedState?: Hook | null };
        let cur = (el as unknown as Record<string, Fiber | undefined>)[fiberKey];
        while (cur) {
          let hook = cur.memoizedState;
          while (hook) {
            const val = hook.memoizedState as
              | { status?: string; config?: { mindroom?: { canvas?: Record<string, unknown> } } }
              | undefined;
            if (val && val.status === 'ready' && val.config && hook.queue?.dispatch) {
              hook.queue.dispatch({
                status: 'ready',
                config: {
                  ...val.config,
                  mindroom: {
                    ...val.config.mindroom,
                    canvas: { ...val.config.mindroom?.canvas, remoteAssets: true },
                  },
                },
              });
              return true;
            }
            hook = hook.next ?? undefined;
          }
          cur = cur.return ?? undefined;
        }
        return false;
      });
      expect(flipped).toBe(true);

      // The replacement iframe mounts via generation and loads the previously blocked https: asset.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const nowEl = document.querySelector('iframe[title="Live Remote Canvas"]');
            const prev = (window as unknown as { __beforeFlipFrame?: Element }).__beforeFlipFrame;
            return nowEl !== null && nowEl !== prev;
          })
        )
        .toBe(true);
      await expect(inner.locator('#remote')).toHaveText('on', { timeout: 15_000 });
      await expect(inner.locator('#remote-asset')).toHaveText('loaded:1', { timeout: 15_000 });
      expect(remoteAssetHits).toBeGreaterThanOrEqual(1);
    } finally {
      await session.close();
      await mock.close();
    }
  });
});
