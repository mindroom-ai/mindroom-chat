import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { COMPOSER_NAME } from '../helpers/composerName';
import { createRoom } from '../helpers/createRoom';
import { DISPOSABLE_HOMESERVER } from '../helpers/disposableAccounts';
import { assertNoUnexpectedViolations, launchDesktop } from '../helpers/electronApp';
import { loginToMatrix, matrixFetch } from '../helpers/matrix';

const APP_ORIGIN = 'capacitor://localhost';

// Valid 32x32 RGBA PNG so the timeline and lightbox image have a clear hit target for right-click.
const TEST_IMAGE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVR4nO3OIQEAAAgDMMIRjnB0ghg3E/Ornr2kEhAQEBAQEBAQEBAQEBAQSAceyutcl27q+AMAAAAASUVORK5CYII=',
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

test('zoom shortcuts and View menu each step zoom by exactly one step', async () => {
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

    // One press of Cmd/Ctrl+= must step by EXACTLY one step (100% -> 110%).
    await page.keyboard.press(`${mod}+Equal`);
    await expect.poll(readFontSize).toBe('110%');
    await page.waitForTimeout(100);
    expect(await readFontSize()).toBe('110%');

    // One press of Cmd/Ctrl+Shift+= (Cmd++/Ctrl++) must also step by EXACTLY one step (110% -> 125%).
    await page.keyboard.press(`${mod}+Shift+Equal`);
    await expect.poll(readFontSize).toBe('125%');
    await page.waitForTimeout(100);
    expect(await readFontSize()).toBe('125%');

    // View -> Zoom In steps by EXACTLY one more step (125% -> 150%).
    await clickViewMenu('Zoom In');
    await expect.poll(readFontSize).toBe('150%');

    // View -> Zoom Out steps back one (150% -> 125%).
    await clickViewMenu('Zoom Out');
    await expect.poll(readFontSize).toBe('125%');

    // Keyboard Cmd/Ctrl+- steps back one (125% -> 110%).
    await page.keyboard.press(`${mod}+Minus`);
    await expect.poll(readFontSize).toBe('110%');

    // View -> Actual Size resets to 100% (clears inline fontSize).
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

test('cancelled app.quit() via beforeunload preserves macOS close-to-hide', async () => {
  test.skip(process.platform !== 'darwin', 'close-to-hide is macOS-only');
  const session = await launchDesktop({ offline: true });
  try {
    const { app, page } = session;
    const serverInput = page.locator('input[name="serverInput"]');
    await expect(serverInput).toBeVisible();

    // Electron handles beforeunload natively via will-prevent-unload without showing a JS dialog;
    // register a no-op dialog listener so Playwright does not call Page.handleJavaScriptDialog.
    page.on('dialog', () => undefined);

    // Give the page sticky user activation so Chromium honors beforeunload cancellation.
    await serverInput.click();

    await page.evaluate(() => {
      const w = window as unknown as {
        __p4BeforeUnload?: (event: BeforeUnloadEvent) => void;
        __p4BeforeUnloadFired?: number;
      };
      w.__p4BeforeUnloadFired = 0;
      const handler = (event: BeforeUnloadEvent): void => {
        w.__p4BeforeUnloadFired = (w.__p4BeforeUnloadFired ?? 0) + 1;
        event.preventDefault();
        event.returnValue = '';
      };
      w.__p4BeforeUnload = handler;
      window.addEventListener('beforeunload', handler);
    });

    await app.evaluate(({ app: electronApp }) => {
      electronApp.quit();
    });

    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __p4BeforeUnloadFired?: number }).__p4BeforeUnloadFired ?? 0
        )
      )
      .toBe(1);

    await page.waitForTimeout(200);
    expect(
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        return {
          count: BrowserWindow.getAllWindows().length,
          visible: win?.isVisible() ?? false,
        };
      })
    ).toEqual({ count: 1, visible: true });

    // Remove the beforeunload block and close the window: it must hide rather than destroy.
    await page.evaluate(() => {
      const w = window as unknown as {
        __p4BeforeUnload?: (event: BeforeUnloadEvent) => void;
      };
      if (w.__p4BeforeUnload) {
        window.removeEventListener('beforeunload', w.__p4BeforeUnload);
        w.__p4BeforeUnload = undefined;
      }
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

    await app.evaluate(({ app: electronApp }) => {
      electronApp.emit('activate');
    });

    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)
      )
      .toBe(true);
    await expect(serverInput).toBeVisible();
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
        navigator.mediaDevices.getDisplayMedia({ video: true }).then(
          () => {
            w.__gdmMainResult = 'granted';
          },
          (err: unknown) => {
            w.__gdmMainResult =
              typeof err === 'object' && err !== null && 'name' in err
                ? String(err.name)
                : String(err);
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
      .toMatch(/^NotAllowedError/);
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
        win.navigator.mediaDevices.getDisplayMedia({ video: true }).then(
          () => {
            parentWin.__gdmSubResult = 'granted';
          },
          (err: unknown) => {
            parentWin.__gdmSubResult =
              typeof err === 'object' && err !== null && 'name' in err
                ? String(err.name)
                : String(err);
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
      .toMatch(/^NotAllowedError/);
  } finally {
    await enabledSession.close();
  }
});

test('@homeserver closing window while recording stops live tracks, keeps page alive, and recovers on activate', async () => {
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

    const installAudioTrackRecorder = (): void => {
      const w = window as unknown as {
        __p4AudioTracks?: MediaStreamTrack[];
        __p4GetUserMediaWrapped?: boolean;
      };
      if (!w.__p4AudioTracks) w.__p4AudioTracks = [];
      if (w.__p4GetUserMediaWrapped || !navigator.mediaDevices?.getUserMedia) return;
      w.__p4GetUserMediaWrapped = true;
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await orig(constraints);
        for (const track of stream.getAudioTracks()) {
          w.__p4AudioTracks?.push(track);
        }
        return stream;
      };
    };

    await page.addInitScript(installAudioTrackRecorder);
    await page.evaluate(installAudioTrackRecorder);

    await loginWithPassword(page, {
      homeserver,
      username,
      password,
      baseUrl: APP_ORIGIN,
    });
    await page.getByRole('link', { name: roomName }).first().click({ timeout: 30_000 });

    const aliveMarker = `alive-${suffix}`;
    await page.evaluate((marker: string) => {
      (window as unknown as { __p4AliveMarker?: string }).__p4AliveMarker = marker;
    }, aliveMarker);

    const recordButton = page
      .getByRole('button', { name: 'Record voice message', exact: true })
      .first();
    await expect(recordButton).toBeEnabled();
    await recordButton.click();

    // Confirm at least one audio track is actively live before closing the window.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const tracks =
            (window as unknown as { __p4AudioTracks?: MediaStreamTrack[] }).__p4AudioTracks ?? [];
          return tracks.some((track) => track.readyState === 'live');
        })
      )
      .toBe(true);

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

    // While the window is still hidden and before activate, every recorded audio track must end.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const tracks =
            (window as unknown as { __p4AudioTracks?: MediaStreamTrack[] }).__p4AudioTracks ?? [];
          return tracks.length > 0 && tracks.every((track) => track.readyState === 'ended');
        })
      )
      .toBe(true);

    // Reopen via activate: page stayed alive (marker unchanged) and recovered recording is waiting.
    await app.evaluate(({ app: electronApp }) => {
      electronApp.emit('activate');
    });
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)
      )
      .toBe(true);
    expect(
      await page.evaluate(
        () => (window as unknown as { __p4AliveMarker?: string }).__p4AliveMarker
      )
    ).toBe(aliveMarker);
    await expect(page.getByText(/^Recovered recording · /)).toBeVisible({ timeout: 15_000 });
  } finally {
    await session.close();
  }
});

test('@homeserver CallPanel omits screenshare button when screenShare is false', async () => {
  const homeserver = process.env.E2E_HOMESERVER_URL ?? DISPOSABLE_HOMESERVER;
  const suffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const username = `desktop_call_${suffix}`;
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
  const roomName = `Call NoShare ${suffix}`;
  await createRoom(homeserver, alice.accessToken, { name: roomName });

  const session = await launchDesktop({ screenShare: false, fakeMedia: true });
  const releasePendingLivekit: Array<() => void> = [];
  try {
    const { page } = session;
    await page.route(
      '**/_matrix/client/unstable/org.matrix.msc4143/rtc/transports*',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            rtc_transports: [{ type: 'livekit', livekit_service_url: 'http://127.0.0.1:9/livekit' }],
          }),
        });
      }
    );
    await page.route('http://127.0.0.1:9/livekit/**', async (route) => {
      await new Promise<void>((resolve) => {
        releasePendingLivekit.push(resolve);
      });
      await route.abort().catch(() => undefined);
    });

    await loginWithPassword(page, {
      homeserver,
      username,
      password,
      baseUrl: APP_ORIGIN,
    });
    await page.getByRole('link', { name: roomName }).first().click({ timeout: 30_000 });

    const startCall = page.getByRole('button', { name: 'Start a call', exact: true }).first();
    await expect(startCall).toBeVisible({ timeout: 20_000 });
    await startCall.click();

    const joinCall = page.getByRole('button', { name: 'Join', exact: true }).first();
    await expect(joinCall).toBeVisible({ timeout: 15_000 });
    await joinCall.click();

    const toolbar = page.getByRole('toolbar').first();
    await expect(toolbar).toBeVisible({ timeout: 15_000 });
    await expect(toolbar.getByRole('button', { name: /camera/i }).first()).toBeVisible();
    await expect(toolbar.getByRole('button', { name: /screenshare/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /screenshare/i })).toHaveCount(0);
  } finally {
    for (const release of releasePendingLivekit.splice(0)) release();
    await session.page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
    await session.close();
  }
});

test('@homeserver real right-click opens Copy Image Address (without access_token) and composer edit menu', async () => {
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
      body: new Uint8Array(TEST_IMAGE_PNG),
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
        info: { mimetype: 'image/png', w: 32, h: 32, size: TEST_IMAGE_PNG.length },
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

    const timeline = page.getByTestId('room-virtual-inner');
    await expect(timeline).toBeVisible({ timeout: 20_000 });
    const timelineImage = timeline.locator('img[alt="ctx-picture.png"]').first();
    await expect(timelineImage).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() =>
        timelineImage.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)
      )
      .toBe(true);

    // Install a non-blocking capture stub for Menu.buildFromTemplate so real right-clicks
    // record the built context menu template without opening a blocking native OS popup.
    await app.evaluate(({ Menu }) => {
      type CapturedStore = {
        originalBuild?: typeof Menu.buildFromTemplate;
        captured?: Array<Array<Electron.MenuItemConstructorOptions | Electron.MenuItem>>;
      };
      const g = globalThis as unknown as { __p4ContextMenuCapture?: CapturedStore };
      const originalBuild = Menu.buildFromTemplate.bind(Menu);
      const captured: Array<Array<Electron.MenuItemConstructorOptions | Electron.MenuItem>> = [];
      g.__p4ContextMenuCapture = { originalBuild, captured };
      Menu.buildFromTemplate = (template) =>
        ({
          popup: () => {
            captured.push(template);
          },
        }) as unknown as Electron.Menu;
    });

    try {
      // 1. Open the image viewer lightbox and perform a REAL right-click on its <img>.
      await timelineImage.click();
      const lightbox = page.getByRole('dialog', { name: 'ctx-picture.png' });
      await expect(lightbox).toBeVisible({ timeout: 15_000 });
      const lightboxImage = lightbox.locator('img[alt="ctx-picture.png"]').first();
      await expect(lightboxImage).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(() =>
          lightboxImage.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)
        )
        .toBe(true);

      const imgSrc = await lightboxImage.evaluate((el: HTMLImageElement) => el.currentSrc || el.src);
      expect(imgSrc).toMatch(/^blob:|\/_matrix\/client\/v1\/media\//);
      expect(imgSrc).not.toContain('access_token');
      expect(imgSrc).not.toContain(alice.accessToken);

      await lightboxImage.click({ button: 'right' });

      await expect
        .poll(() =>
          app.evaluate(() => {
            const g = globalThis as unknown as {
              __p4ContextMenuCapture?: { captured?: Electron.MenuItemConstructorOptions[][] };
            };
            const last = g.__p4ContextMenuCapture?.captured?.at(-1);
            return last ? last.map((item) => item.label ?? item.role ?? item.type ?? '') : [];
          })
        )
        .toContain('Copy Image Address');

      const clicked = await app.evaluate(async ({ BrowserWindow, clipboard }) => {
        const g = globalThis as unknown as {
          __p4ContextMenuCapture?: { captured?: Electron.MenuItemConstructorOptions[][] };
        };
        const last = g.__p4ContextMenuCapture?.captured?.at(-1);
        const copyItem = last?.find((item) => item.label === 'Copy Image Address');
        const win = BrowserWindow.getAllWindows()[0];
        if (!copyItem?.click || !win) return false;
        await clipboard.writeText('');
        copyItem.click({} as Electron.MenuItem, win, {});
        return true;
      });
      expect(clicked).toBe(true);

      await expect
        .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
        .toBe(imgSrc);
      const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
      expect(copied).not.toContain('access_token');
      expect(copied).not.toContain(alice.accessToken);

      // Dismiss the lightbox before testing the composer context menu.
      await page.keyboard.press('Escape');
      await expect(lightbox).toBeHidden({ timeout: 10_000 });

      // 2. Perform a REAL right-click in the message composer and verify Cut, Copy, and Paste.
      await app.evaluate(() => {
        const g = globalThis as unknown as {
          __p4ContextMenuCapture?: { captured?: Electron.MenuItemConstructorOptions[][] };
        };
        if (g.__p4ContextMenuCapture?.captured) g.__p4ContextMenuCapture.captured.length = 0;
      });

      const composer = page.getByRole('textbox', { name: COMPOSER_NAME }).first();
      await expect(composer).toBeVisible({ timeout: 15_000 });
      await composer.click();
      await composer.click({ button: 'right' });

      await expect
        .poll(() =>
          app.evaluate(() => {
            const g = globalThis as unknown as {
              __p4ContextMenuCapture?: { captured?: Electron.MenuItemConstructorOptions[][] };
            };
            const last = g.__p4ContextMenuCapture?.captured?.at(-1);
            return last
              ? last.map((item) => String(item.role ?? item.label ?? item.type ?? '').toLowerCase())
              : [];
          })
        )
        .toEqual(expect.arrayContaining(['cut', 'copy', 'paste']));
    } finally {
      await app
        .evaluate(({ Menu }) => {
          const g = globalThis as unknown as {
            __p4ContextMenuCapture?: { originalBuild?: typeof Menu.buildFromTemplate };
          };
          if (g.__p4ContextMenuCapture?.originalBuild) {
            Menu.buildFromTemplate = g.__p4ContextMenuCapture.originalBuild;
          }
          delete g.__p4ContextMenuCapture;
        })
        .catch(() => undefined);
    }
  } finally {
    await session.close();
  }
});
