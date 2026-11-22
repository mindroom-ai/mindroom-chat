import { expect, test } from '@playwright/test';
import { assertNoUnexpectedViolations, launchDesktop } from '../helpers/electronApp';
import { startMockMatrixServer } from '../helpers/mockMatrixServer';

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

test.afterEach(() => assertNoUnexpectedViolations());

test.describe('Electron external link handling', () => {
  test('opens only trusted clicks on openable links/buttons and blocks scripted/editable/forged opens', async () => {
    const session = await launchDesktop();
    try {
      const { app, page } = session;
      await expect(page.locator('input[name="serverInput"]')).toBeVisible();

      // The bridge exposes no openExternal function.
      expect(await page.evaluate(() => 'openExternal' in (window.mindroomDesktop ?? {}))).toBe(
        false
      );

      // Inject controlled test elements for trusted vs scripted/editable/forged click checks.
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
          return el;
        };

        mk('a', 'e2e-link-primary', 'Primary', { href: 'https://example.org/primary' });
        mk('a', 'e2e-link-middle', 'Middle', {
          href: 'https://example.org/middle',
          target: '_blank',
        });
        mk('a', 'e2e-link-enter', 'EnterBlank', {
          href: 'https://example.org/enter-blank',
          target: '_blank',
          rel: 'noopener noreferrer',
        });
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
        mk('a', 'e2e-link-mailto', 'MailLink', { href: 'mailto:someone@example.org' });
        // Links that save rather than open; the address refuses connections at once.
        mk('a', 'e2e-link-alt', 'AltLink', { href: 'http://127.0.0.1:9/alt-click' });
        mk('a', 'e2e-link-download', 'DownloadLink', {
          href: 'http://127.0.0.1:9/download',
          download: '',
        });
        mk('button', 'e2e-btn-relative', 'RelativeBtn', {
          type: 'button',
          'data-open-external': '/home',
        });

        // Link inside a contenteditable editor must not open externally when clicked.
        const editable = document.createElement('div');
        editable.setAttribute('contenteditable', 'true');
        const editableLink = document.createElement('a');
        editableLink.id = 'e2e-link-editable';
        editableLink.href = 'https://example.org/in-editor';
        editableLink.textContent = 'EditableLink';
        editable.appendChild(editableLink);
        box.appendChild(editable);

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

      // Scripted opens must open nothing.
      await page.evaluate(() => {
        (document.getElementById('e2e-link-scripted') as HTMLAnchorElement).click();
        (document.getElementById('e2e-btn-scripted') as HTMLButtonElement).click();
        window.open('https://example.org/window-open');
      });

      // Forged, blocked, and contenteditable clicks must open nothing.
      await clickEl('#e2e-span-forged');
      await clickEl('#e2e-link-forged-attr');
      await clickEl('#e2e-link-media');
      await clickEl('#e2e-link-token');
      await clickEl('#e2e-btn-js');
      await clickEl('#e2e-link-file');
      await clickEl('#e2e-link-editable');
      await clickEl('#e2e-link-download');
      await clickEl('#e2e-btn-relative');
      await page.keyboard.down('Alt');
      await clickEl('#e2e-link-alt');
      await page.keyboard.up('Alt');

      // Real primary click, middle click on a _blank link, Enter on a _blank link, and a click on
      // a mailto link: once each.
      await clickEl('#e2e-link-primary');
      await clickEl('#e2e-link-middle', 'middle');
      await page.evaluate(() => (document.getElementById('e2e-link-enter') as HTMLElement).focus());
      await page.keyboard.press('Enter');
      await clickEl('#e2e-link-mailto');

      await expect
        .poll(async () => (await readTelemetry(app)).externalOpens)
        .toEqual([
          'https://example.org/primary',
          'https://example.org/middle',
          'https://example.org/enter-blank',
          'mailto:someone@example.org',
        ]);
      expect(app.windows()).toHaveLength(1);
    } finally {
      await session.close();
    }
  });

  test('opens rendered message links once, confirms misleading links, and opens server from profile menu once', async () => {
    const now = Date.now();
    const mockServer = await startMockMatrixServer(
      [
        {
          type: 'm.room.message',
          event_id: '$msg_links',
          sender: SENDER_ID,
          origin_server_ts: now - 1_000,
          room_id: ROOM_ID,
          content: {
            msgtype: 'm.text',
            body: 'https://good.example https://example.org/docs',
            format: 'org.matrix.custom.html',
            formatted_body:
              '<p><a href="https://evil.example/phish">https://good.example</a></p>' +
              '<p><a href="https://example.org/docs">Docs</a></p>',
          },
        },
      ],
      {
        roomId: ROOM_ID,
        roomName: 'Links Room',
        userId: USER_ID,
        otherUserId: SENDER_ID,
        otherDisplayName: 'Alice',
      }
    );
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

      // Normal rendered message link (sanitizer adds target="_blank") opens once and denies popup.
      const normalLink = page.getByRole('link', { name: 'Docs' });
      await expect(normalLink).toBeVisible({ timeout: 30_000 });
      await expect(normalLink).toHaveAttribute('target', '_blank');
      await normalLink.click();
      await expect
        .poll(async () => (await readTelemetry(app)).externalOpens)
        .toEqual(['https://example.org/docs']);
      await expect
        .poll(async () => (await readTelemetry(app)).blockedUrls)
        .toContain('https://example.org/docs');
      expect(app.windows()).toHaveLength(1);

      // Misleading link -> dialog opens; Cancel opens nothing; Open link opens exactly once.
      const misleadingLink = page.getByRole('link', { name: 'https://good.example' });
      await misleadingLink.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: /cancel/i }).click();
      await expect(dialog).toHaveCount(0);
      // Let a wrongly sent open arrive before reading: Cancel must have opened nothing.
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));
      expect((await readTelemetry(app)).externalOpens).toEqual(['https://example.org/docs']);

      await misleadingLink.click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: /open link/i }).click();
      await expect(dialog).toHaveCount(0);

      await expect
        .poll(async () => (await readTelemetry(app)).externalOpens)
        .toEqual(['https://example.org/docs', 'https://evil.example/phish']);

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
        .toEqual([
          'https://example.org/docs',
          'https://evil.example/phish',
          'https://example.test/',
        ]);
    } finally {
      await session.close();
      await mockServer.close();
    }
  });
});
