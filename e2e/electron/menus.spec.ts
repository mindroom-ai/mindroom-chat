import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { DISPOSABLE_HOMESERVER } from '../helpers/disposableAccounts';
import { assertNoUnexpectedViolations, launchDesktop } from '../helpers/electronApp';
import { loginToMatrix, matrixFetch } from '../helpers/matrix';

const APP_ORIGIN = 'capacitor://localhost';

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

test.afterEach(assertNoUnexpectedViolations);

test('application menu omits reload, native zoom roles, and New Window', async () => {
  const session = await launchDesktop({ offline: true });
  try {
    const { app, page } = session;
    await expect(page.locator('input[name="serverInput"]')).toBeVisible();

    const menuSnapshot = await app.evaluate(({ Menu }) => {
      type ItemSummary = { label: string; role: string; accelerator: string };
      const collect = (menu: Electron.Menu | null): ItemSummary[] => {
        if (!menu) return [];
        const out: ItemSummary[] = [];
        for (const item of menu.items) {
          out.push({
            label: item.label ?? '',
            role: String(item.role ?? '').toLowerCase(),
            accelerator: item.accelerator ?? '',
          });
          if (item.submenu) out.push(...collect(item.submenu));
        }
        return out;
      };
      const appMenu = Menu.getApplicationMenu();
      return {
        topLabels: appMenu ? appMenu.items.map((i) => i.label) : [],
        items: collect(appMenu),
      };
    });

    expect(menuSnapshot.topLabels.length).toBeGreaterThanOrEqual(5);
    expect(menuSnapshot.topLabels).toEqual(expect.arrayContaining(['Edit', 'View', 'Window']));

    const forbiddenRoles = new Set(['reload', 'forcereload', 'zoomin', 'zoomout', 'resetzoom']);
    for (const item of menuSnapshot.items) {
      expect(forbiddenRoles.has(item.role), `unexpected role ${item.role}`).toBe(false);
      expect(item.label.toLowerCase()).not.toBe('new window');
    }

    expect(menuSnapshot.items.some((i) => i.label === 'Zoom In')).toBe(true);
    expect(menuSnapshot.items.some((i) => i.label === 'Zoom Out')).toBe(true);
    expect(menuSnapshot.items.some((i) => i.label === 'Actual Size')).toBe(true);
  } finally {
    await session.close();
  }
});

test('zoom shortcut and View menu each step zoom by exactly one step', async () => {
  const session = await launchDesktop({ offline: true });
  try {
    const { app, page } = session;
    await expect(page.locator('input[name="serverInput"]')).toBeVisible();

    const readFontSize = () => page.evaluate(() => document.documentElement.style.fontSize);

    const clickViewMenu = async (label: 'Zoom In' | 'Zoom Out' | 'Actual Size') => {
      const clicked = await app.evaluate(({ Menu }, target: string) => {
        const appMenu = Menu.getApplicationMenu();
        const view = appMenu?.items.find((i) => i.label === 'View')?.submenu;
        const item = view?.items.find((i) => i.label === target);
        if (!item) return false;
        item.click();
        return true;
      }, label);
      expect(clicked, `View -> ${label} should exist`).toBe(true);
    };

    expect(await readFontSize()).toBe('');

    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

    // One key press of Cmd/Ctrl+= must step by EXACTLY one step (100% -> 110%).
    await page.keyboard.press(`${mod}+Equal`);
    await expect.poll(readFontSize).toBe('110%');
    // Pause briefly to verify no delayed second step arrives from a duplicate accelerator.
    await page.waitForTimeout(100);
    expect(await readFontSize()).toBe('110%');

    // View -> Zoom In steps by EXACTLY one more step (110% -> 125%).
    await clickViewMenu('Zoom In');
    await expect.poll(readFontSize).toBe('125%');

    // View -> Zoom Out steps back one (125% -> 110%).
    await clickViewMenu('Zoom Out');
    await expect.poll(readFontSize).toBe('110%');

    // Keyboard Cmd/Ctrl+- steps back one (110% -> 100%, which clears inline fontSize).
    await page.keyboard.press(`${mod}+Minus`);
    await expect.poll(readFontSize).toBe('');

    // Zoom in twice via menu, then reset via Actual Size.
    await clickViewMenu('Zoom In');
    await clickViewMenu('Zoom In');
    await expect.poll(readFontSize).toBe('125%');

    await clickViewMenu('Actual Size');
    await expect.poll(readFontSize).toBe('');
  } finally {
    await session.close();
  }
});

test('mouse back and forward buttons walk history by one entry on release only', async () => {
  const session = await launchDesktop({ offline: true });
  try {
    const { page } = session;
    await expect(page.locator('input[name="serverInput"]')).toBeVisible();

    // Stay under /login so React Router never redirects on popstate while signed out.
    await page.evaluate(() => {
      window.history.pushState({ step: 1 }, '', '/login?p4step=1');
      window.history.pushState({ step: 2 }, '', '/login?p4step=2');
      window.history.pushState({ step: 3 }, '', '/login?p4step=3');
    });
    expect(await page.evaluate(() => window.location.search)).toBe('?p4step=3');

    const cdp = await page.context().newCDPSession(page);
    try {
      // Back press must NOT navigate.
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: 200,
        y: 200,
        button: 'back',
        buttons: 8,
        clickCount: 1,
      });
      await page.waitForTimeout(100);
      expect(await page.evaluate(() => window.location.search)).toBe('?p4step=3');

      // Back release must navigate back EXACTLY one entry.
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: 200,
        y: 200,
        button: 'back',
        buttons: 0,
        clickCount: 1,
      });
      await expect.poll(() => page.evaluate(() => window.location.search)).toBe('?p4step=2');
      await page.waitForTimeout(150);
      expect(await page.evaluate(() => window.location.search)).toBe('?p4step=2');

      // Forward press must NOT navigate.
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: 200,
        y: 200,
        button: 'forward',
        buttons: 16,
        clickCount: 1,
      });
      await page.waitForTimeout(100);
      expect(await page.evaluate(() => window.location.search)).toBe('?p4step=2');

      // Forward release must navigate forward EXACTLY one entry.
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: 200,
        y: 200,
        button: 'forward',
        buttons: 0,
        clickCount: 1,
      });
      await expect.poll(() => page.evaluate(() => window.location.search)).toBe('?p4step=3');
      await page.waitForTimeout(150);
      expect(await page.evaluate(() => window.location.search)).toBe('?p4step=3');
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  } finally {
    await session.close();
  }
});

test('window state saves bounds and restores them across relaunch', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mindroom-desktop-winstate-'));
  try {
    const first = await launchDesktop({ offline: true, userData });
    let savedBounds = { width: 0, height: 0 };
    try {
      await expect(first.page.locator('input[name="serverInput"]')).toBeVisible();
      savedBounds = await first.app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return { width: 0, height: 0 };
        win.setBounds({ x: 80, y: 80, width: 900, height: 640 });
        await new Promise((resolve) => setTimeout(resolve, 350));
        const b = win.getBounds();
        return { width: b.width, height: b.height };
      });
      expect(savedBounds.width).toBeGreaterThanOrEqual(850);
      expect(savedBounds.width).toBeLessThanOrEqual(950);
      expect(savedBounds.height).toBeGreaterThanOrEqual(600);
      expect(savedBounds.height).toBeLessThanOrEqual(680);
    } finally {
      await first.close();
    }

    expect(fs.existsSync(path.join(userData, 'window-state.json'))).toBe(true);

    const second = await launchDesktop({ offline: true, userData });
    try {
      await expect(second.page.locator('input[name="serverInput"]')).toBeVisible();
      const restored = await second.app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        return win ? win.getBounds() : { x: 0, y: 0, width: 0, height: 0 };
      });
      expect(Math.abs(restored.width - savedBounds.width)).toBeLessThanOrEqual(4);
      expect(Math.abs(restored.height - savedBounds.height)).toBeLessThanOrEqual(4);
    } finally {
      await second.close();
    }
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('showMainWindow IPC restores the window, and macOS close hides and reopens on activate', async () => {
  const session = await launchDesktop({ offline: true });
  try {
    const { app, page } = session;
    await expect(page.locator('input[name="serverInput"]')).toBeVisible();

    // Hide the window, then bring it back through the preload showMainWindow IPC.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.hide();
    });
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)
      )
      .toBe(false);

    const showResult = await page.evaluate(() => window.mindroomDesktop?.showMainWindow());
    expect(showResult).toEqual({ ok: true, value: undefined });
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)
      )
      .toBe(true);

    if (process.platform === 'darwin') {
      await page.evaluate(() => {
        const w = window as unknown as { __hiddenEvents?: number };
        w.__hiddenEvents = 0;
        window.mindroomDesktop?.onShellEvent((ev) => {
          if (ev.type === 'window-hidden') w.__hiddenEvents = (w.__hiddenEvents ?? 0) + 1;
        });
      });

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close();
      });

      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            return {
              count: BrowserWindow.getAllWindows().length,
              visible: win?.isVisible() ?? false,
            };
          })
        )
        .toEqual({ count: 1, visible: false });

      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { __hiddenEvents?: number }).__hiddenEvents ?? 0
          )
        )
        .toBe(1);

      await app.evaluate(({ app: electronApp }) => {
        electronApp.emit('activate');
      });

      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)
        )
        .toBe(true);
      await expect(page.locator('input[name="serverInput"]')).toBeVisible();
    }
  } finally {
    await session.close();
  }
});

test('screenShare=false disables bridge screenShare and subframe getDisplayMedia is denied', async () => {
  const session = await launchDesktop({ offline: true, screenShare: false });
  try {
    const { page } = session;
    await expect(page.locator('input[name="serverInput"]')).toBeVisible();

    const bridgeFlag = await page.evaluate(() => window.mindroomDesktop?.screenShare);
    expect(bridgeFlag).toBe(false);

    // Main-frame getDisplayMedia with user activation must reject with NotAllowedError when disabled.
    await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.id = 'p4-gdm-main';
      btn.textContent = 'Probe';
      btn.style.position = 'fixed';
      btn.style.top = '40px';
      btn.style.left = '40px';
      btn.style.zIndex = '99999';
      btn.addEventListener('click', () => {
        const w = window as unknown as { __gdmMainResult?: string };
        navigator.mediaDevices
          .getDisplayMedia({ video: true })
          .then(
            () => {
              w.__gdmMainResult = 'granted';
            },
            (err: unknown) => {
              w.__gdmMainResult = err instanceof Error ? err.name : String(err);
            }
          );
      });
      document.body.appendChild(btn);
    });
    await page.locator('#p4-gdm-main').click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __gdmMainResult?: string }).__gdmMainResult)
      )
      .toBe('NotAllowedError');
  } finally {
    await session.close();
  }

  // Even when screenShare is enabled, a same-origin subframe must be denied getDisplayMedia.
  const enabledSession = await launchDesktop({ offline: true, screenShare: true });
  try {
    const { page } = enabledSession;
    await expect(page.locator('input[name="serverInput"]')).toBeVisible();
    expect(await page.evaluate(() => window.mindroomDesktop?.screenShare)).toBe(true);

    await page.evaluate(() => {
      const frame = document.createElement('iframe');
      frame.id = 'p4-gdm-subframe';
      frame.allow = 'display-capture';
      frame.style.position = 'fixed';
      frame.style.top = '40px';
      frame.style.left = '40px';
      frame.style.width = '120px';
      frame.style.height = '60px';
      frame.style.zIndex = '99999';
      document.body.appendChild(frame);

      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      if (!doc || !win) return;
      const btn = doc.createElement('button');
      btn.id = 'p4-gdm-sub-btn';
      btn.textContent = 'SubProbe';
      btn.style.width = '100px';
      btn.style.height = '40px';
      btn.addEventListener('click', () => {
        const parentWin = window as unknown as { __gdmSubResult?: string };
        win.navigator.mediaDevices
          .getDisplayMedia({ video: true })
          .then(
            () => {
              parentWin.__gdmSubResult = 'granted';
            },
            (err: unknown) => {
              parentWin.__gdmSubResult = err instanceof Error ? err.name : String(err);
            }
          );
      });
      doc.body.appendChild(btn);
    });

    await page.frameLocator('#p4-gdm-subframe').locator('#p4-gdm-sub-btn').click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __gdmSubResult?: string }).__gdmSubResult)
      )
      .toBe('NotAllowedError');
  } finally {
    await enabledSession.close();
  }
});

test('@homeserver closing window while recording parks voice message and recovers on activate', async () => {
  test.skip(process.platform !== 'darwin', 'close-to-hide is macOS-only');
  const homeserver = process.env.E2E_HOMESERVER_URL ?? DISPOSABLE_HOMESERVER;
  const suffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const username = `desktop_voice_${suffix}`;
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
  expect(reg.ok).toBe(true);
  const alice = await loginToMatrix(homeserver, username, password);
  const roomName = `Voice Close ${suffix}`;
  await createRoom(homeserver, alice.accessToken, { name: roomName });

  const session = await launchDesktop({ fakeMedia: true });
  try {
    const { app, page } = session;
    await loginWithPassword(page, {
      homeserver,
      username,
      password,
      baseUrl: APP_ORIGIN,
    });
    await page.getByRole('link', { name: roomName }).first().click({ timeout: 30_000 });

    const recordButton = page
      .getByRole('button', { name: 'Record voice message', exact: true })
      .first();
    await expect(recordButton).toBeEnabled();
    await recordButton.click();

    // Let the fake microphone record audio briefly so the journal captures bytes.
    await page.waitForTimeout(1_500);

    // Close the window on macOS -> hides and sends window-hidden -> parks live voice recording.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)
      )
      .toBe(false);

    // Reopen via activate: page is still alive and the parked recording is waiting for recovery.
    await app.evaluate(({ app: electronApp }) => {
      electronApp.emit('activate');
    });
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)
      )
      .toBe(true);
    await expect(page.getByText(/^Recovered recording · /)).toBeVisible({ timeout: 15_000 });
  } finally {
    await session.close();
  }
});

test('@homeserver Copy Image Address on an authenticated image copies a URL without access_token', async () => {
  const homeserver = process.env.E2E_HOMESERVER_URL ?? DISPOSABLE_HOMESERVER;
  const suffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const username = `desktop_ctx_${suffix}`;
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
  expect(reg.ok).toBe(true);
  const alice = await loginToMatrix(homeserver, username, password);

  const uploadRes = await fetch(
    `${homeserver}/_matrix/media/v3/upload?filename=${encodeURIComponent('ctx-picture.png')}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${alice.accessToken}`,
        'Content-Type': 'image/png',
      },
      body: new Uint8Array(PIXEL_PNG),
    }
  );
  expect(uploadRes.ok).toBe(true);
  const { content_uri: imageUri } = (await uploadRes.json()) as { content_uri?: string };
  expect(imageUri).toMatch(/^mxc:\/\//);

  const roomName = `Context Image ${suffix}`;
  const roomId = await createRoom(homeserver, alice.accessToken, { name: roomName });
  await matrixFetch(
    homeserver,
    `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/ctx_${suffix}`,
    {
      method: 'PUT',
      accessToken: alice.accessToken,
      body: JSON.stringify({
        msgtype: 'm.image',
        body: 'ctx-picture.png',
        url: imageUri,
        info: { mimetype: 'image/png', w: 1, h: 1, size: PIXEL_PNG.length },
      }),
    }
  );

  const session = await launchDesktop();
  try {
    const { app, page } = session;
    await loginWithPassword(page, {
      homeserver,
      username,
      password,
      baseUrl: APP_ORIGIN,
    });
    await page.getByRole('link', { name: roomName }).first().click({ timeout: 30_000 });

    const image = page.locator('img[alt="ctx-picture.png"]').first();
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
      .toBe(true);

    const imgSrc = await image.evaluate((el: HTMLImageElement) => el.currentSrc || el.src);
    expect(imgSrc).toMatch(/^blob:|\/_matrix\/client\/v1\/media\//);
    expect(imgSrc).not.toContain('access_token');
    expect(imgSrc).not.toContain(alice.accessToken);

    // Intercept the context menu popup in main, click "Copy Image Address", and check clipboard.
    const clicked = await app.evaluate(
      async ({ BrowserWindow, Menu, clipboard }, srcURL: string) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return false;
        await clipboard.writeText('');
        const originalBuild = Menu.buildFromTemplate.bind(Menu);
        let didClick = false;
        Menu.buildFromTemplate = (template) => {
          const copyItem = template.find((item) => item.label === 'Copy Image Address');
          if (copyItem?.click) {
            copyItem.click({} as Electron.MenuItem, win, {});
            didClick = true;
          }
          return { popup: () => undefined } as unknown as Electron.Menu;
        };
        try {
          win.webContents.emit('context-menu', {}, {
            misspelledWord: '',
            dictionarySuggestions: [],
            isEditable: false,
            selectionText: '',
            linkURL: '',
            mediaType: 'image',
            srcURL,
            editFlags: {
              canUndo: false,
              canRedo: false,
              canCut: false,
              canCopy: false,
              canPaste: false,
              canDelete: false,
              canSelectAll: false,
              canEditRichly: false,
            },
          });
        } finally {
          Menu.buildFromTemplate = originalBuild;
        }
        return didClick;
      },
      imgSrc
    );

    expect(clicked).toBe(true);
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(imgSrc);
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied).not.toContain('access_token');
    expect(copied).not.toContain(alice.accessToken);
  } finally {
    await session.close();
  }
});
