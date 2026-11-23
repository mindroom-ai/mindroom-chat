import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { DISPOSABLE_HOMESERVER } from '../helpers/disposableAccounts';
import {
  assertNoUnexpectedViolations,
  launchDesktop,
  type DesktopSession,
} from '../helpers/electronApp';
import { loginToMatrix } from '../helpers/matrix';

const APP_ORIGIN = 'capacitor://localhost';
const QC_URL = `${APP_ORIGIN}/quick-capture/`;

const clickQuickCaptureMenu = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => {
    const winMenu = Menu.getApplicationMenu()?.items.find((i) => i.label === 'Window')?.submenu;
    const item = winMenu?.items.find((i) => i.label === 'Quick Capture');
    if (!item) return false;
    item.click();
    return true;
  });

const toggleQuickCapture = (app: ElectronApplication) =>
  app.evaluate(() => {
    const qc = (globalThis as { __mindroomTestQuickCapture?: { toggle: () => void } })
      .__mindroomTestQuickCapture;
    if (!qc) throw new Error('__mindroomTestQuickCapture missing');
    qc.toggle();
  });

const quickCaptureVisibility = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const panel = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('/quick-capture')
    );
    return panel ? panel.isVisible() : false;
  });

const openQuickCapture = async (
  session: DesktopSession,
  via: 'menu' | 'test' = 'test'
): Promise<Page> => {
  const { app } = session;
  const winPromise = app.waitForEvent('window');
  if (via === 'menu') expect(await clickQuickCaptureMenu(app)).toBe(true);
  else await toggleQuickCapture(app);
  const panelPage = await winPromise;
  await session.watchPage(panelPage);
  await panelPage.waitForURL(QC_URL);
  await panelPage.waitForLoadState('domcontentloaded');
  await expect.poll(() => quickCaptureVisibility(app)).toBe(true);
  return panelPage;
};

test.afterEach(assertNoUnexpectedViolations);

test('Window -> Quick Capture lazily opens /quick-capture/ with 0px inset, no screenshots, and Escape hides it', async () => {
  const session = await launchDesktop({ offline: true });
  try {
    const { app, page } = session;
    await expect(page.locator('input[name="serverInput"]')).toBeVisible();

    // Never created at startup: only the main window exists before the first toggle.
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    const panelPage = await openQuickCapture(session, 'menu');
    expect(panelPage.url()).toBe(QC_URL);

    await expect(panelPage.locator('[data-native]')).toBeVisible();
    await expect
      .poll(() =>
        panelPage.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--app-inset-top').trim()
        )
      )
      .toBe('0px');

    // P7 exposes no screenshot buttons.
    await expect(
      panelPage.getByRole('button', { name: 'Screenshot of the front window' })
    ).toHaveCount(0);
    await expect(
      panelPage.getByRole('button', { name: 'Screenshot of the whole screen' })
    ).toHaveCount(0);

    // Wait for CaptureNotice so useCaptureEscape is mounted, then Escape hides Quick Capture.
    await expect(panelPage.getByText('Sign in to MindRoom', { exact: true })).toBeVisible();
    await panelPage.keyboard.press('Escape');
    await expect.poll(() => quickCaptureVisibility(app)).toBe(false);
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())
    ).toBe(true);
    await expect(page.locator('input[name="serverInput"]')).toBeVisible();

    // Direct toggle re-shows the existing Quick Capture window without creating a third one.
    await toggleQuickCapture(app);
    await expect.poll(() => quickCaptureVisibility(app)).toBe(true);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2);
  } finally {
    await session.close();
  }
});

test('moving Quick Capture window persists its position across relaunch', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mindroom-desktop-qc-place-'));
  try {
    let savedPos = { x: 0, y: 0 };
    const first = await launchDesktop({ offline: true, userData });
    try {
      await expect(first.page.locator('input[name="serverInput"]')).toBeVisible();
      await openQuickCapture(first);
      savedPos = await first.app.evaluate(async ({ BrowserWindow, screen }) => {
        const panel = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().includes('/quick-capture')
        );
        if (!panel) throw new Error('Quick Capture window missing');
        const area = screen.getPrimaryDisplay().workArea;
        panel.setPosition(area.x + 120, area.y + 90);
        await new Promise((resolve) => setTimeout(resolve, 350));
        const b = panel.getBounds();
        return { x: b.x, y: b.y };
      });
    } finally {
      await first.close();
    }

    expect(fs.existsSync(path.join(userData, 'quick-capture-state.json'))).toBe(true);

    const second = await launchDesktop({ offline: true, userData });
    try {
      await expect(second.page.locator('input[name="serverInput"]')).toBeVisible();
      await openQuickCapture(second);
      const restored = await second.app.evaluate(({ BrowserWindow }) => {
        const panel = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().includes('/quick-capture')
        );
        if (!panel) throw new Error('Quick Capture window missing');
        const b = panel.getBounds();
        return { x: b.x, y: b.y };
      });
      expect(Math.abs(restored.x - savedPos.x)).toBeLessThanOrEqual(4);
      expect(Math.abs(restored.y - savedPos.y)).toBeLessThanOrEqual(4);
    } finally {
      await second.close();
    }
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('Quick Capture pins navigation to /quick-capture/ and main window cannot invoke quick-capture-hide', async () => {
  const session = await launchDesktop({ offline: true });
  try {
    const { app, page } = session;
    await expect(page.locator('input[name="serverInput"]')).toBeVisible();
    const panelPage = await openQuickCapture(session);

    // Main window must not receive the quickCapture preload surface.
    expect(await page.evaluate(() => window.mindroomDesktop?.quickCapture)).toBeUndefined();

    // Navigating Quick Capture to / is blocked and recorded in telemetry.
    await panelPage.evaluate(() => {
      window.location.href = 'capacitor://localhost/';
    });
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as { __mindroomTestTelemetry?: { blockedUrls: string[] } })
              .__mindroomTestTelemetry?.blockedUrls ?? []
        )
      )
      .toContain(`${APP_ORIGIN}/`);
    expect(panelPage.url()).toBe(QC_URL);

    // Invoking desktop:quick-capture-hide from the main window's WebContents is rejected.
    const ipcResult = await app.evaluate(async ({ BrowserWindow, ipcMain }) => {
      const mainWin = BrowserWindow.getAllWindows().find(
        (w) => !w.webContents.getURL().includes('/quick-capture')
      );
      if (!mainWin) throw new Error('Main window missing');
      const handlers = (
        ipcMain as unknown as {
          _invokeHandlers: Map<
            string,
            (
              event: { sender: unknown; senderFrame: unknown },
              ...args: unknown[]
            ) => Promise<unknown>
          >;
        }
      )._invokeHandlers;
      const handler = handlers.get('desktop:quick-capture-hide');
      if (!handler) throw new Error('desktop:quick-capture-hide handler missing');
      return handler({ sender: mainWin.webContents, senderFrame: mainWin.webContents.mainFrame });
    });
    expect(ipcResult).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(await quickCaptureVisibility(app)).toBe(true);
  } finally {
    await session.close();
  }
});

test('@homeserver Quick Capture sends a capture to a room and posts a thread on the main page', async () => {
  const homeserver = process.env.E2E_HOMESERVER_URL ?? DISPOSABLE_HOMESERVER;
  const suffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const username = `desktop_qc_${suffix}`;
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
  const roomName = `Quick Inbox ${suffix}`;
  await createRoom(homeserver, alice.accessToken, { name: roomName });

  const session = await launchDesktop();
  try {
    const { page } = session;
    await loginWithPassword(page, { homeserver, username, password, baseUrl: APP_ORIGIN });
    await page.getByRole('link', { name: roomName }).first().click({ timeout: 30_000 });

    const panelPage = await openQuickCapture(session);
    const rooms = panelPage.getByRole('listbox', { name: 'Choose a room', exact: true });
    await expect(rooms.getByRole('option', { name: roomName })).toBeVisible({ timeout: 30_000 });
    await rooms.getByRole('option', { name: roomName }).click();

    const input = panelPage.getByRole('textbox', { name: 'New entry', exact: true });
    await expect(input).toBeVisible();
    await expect(
      panelPage.getByRole('button', { name: 'Screenshot of the front window' })
    ).toHaveCount(0);
    await expect(
      panelPage.getByRole('button', { name: 'Screenshot of the whole screen' })
    ).toHaveCount(0);

    const captureText = `Quick note ${suffix}`;
    await input.fill(captureText);
    await input.press('Enter');
    await expect(input).toHaveValue('');

    const list = panelPage.getByRole('list', { name: `Threads in ${roomName}`, exact: true });
    await expect(list.getByRole('button', { name: new RegExp(captureText) })).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole('main').getByText(captureText, { exact: true }).first()
    ).toBeVisible({ timeout: 20_000 });
  } finally {
    await session.close();
  }
});
