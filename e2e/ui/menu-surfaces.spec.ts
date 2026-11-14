import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { surfaceShowThrough } from '../helpers/surfaceShowThrough';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// Menus, popovers and dialogs over a busy room are tinted nearly opaque: the room's text behind
// them shows only as a faint blur, and their own labels keep 4.5:1 against what shows through.
// Measured on the message menu, the room header's menu, the command palette and, on a phone, the
// composer's More actions menu, in dark and light themes, in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit. Set MENU_SURFACE_SHOTS=<directory>
// to also save each one.
const PASSWORD = 'menu-surfaces-spec-password';
const SHOTS = process.env.MENU_SURFACE_SHOTS;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const ROOM = 'Project room';
const MESSAGE =
  'The weekly planning notes are ready: we moved the launch review to Thursday, the design team ' +
  'shared three new layouts for the onboarding flow, and the support queue is down to twelve open ' +
  'requests after the release. Please read the summary before the call and add your questions.';

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

/** A fresh account with a room full of long messages, signed in on `page`. */
const signIn = async (page: Page, prefix: string) => {
  const username = `${prefix}_${Date.now().toString(36)}`;
  const { access_token: accessToken } = await matrixFetch<{ access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  const roomId = await createPrivateRoom(HOMESERVER, accessToken, {
    name: ROOM,
    topic: 'Planning and updates',
  });
  for (let index = 0; index < 16; index += 1) {
    // eslint-disable-next-line no-await-in-loop -- the timeline in order.
    await sendRoomMessage(HOMESERVER, accessToken, roomId, {
      msgtype: 'm.text',
      body: `${index + 1}. ${MESSAGE}`,
    });
  }
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  return roomId;
};

/** Stores the theme and opens the room at the size, its last message in view. */
const openRoom = async (page: Page, roomId: string, theme: string, size: typeof DESKTOP) => {
  await page.setViewportSize(size);
  await page.evaluate((id) => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
    localStorage.setItem(
      'settings',
      JSON.stringify({ ...settings, useSystemTheme: false, themeId: id })
    );
  }, theme);
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText(`16. ${MESSAGE.slice(0, 30)}`)).toBeVisible();
};

/** The glass surface `inside` sits in: it, or its first ancestor with a background of its own. */
const surfaceOf = async (page: Page, inside: Locator) => {
  await inside.evaluate((start) => {
    for (let node: Element | null = start; node; node = node.parentElement) {
      const background = getComputedStyle(node).backgroundColor;
      const numbers = background.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
      let alpha = 1;
      if (background.includes('/')) alpha = numbers[numbers.length - 1]!;
      else if (background.startsWith('rgba')) alpha = numbers[3]!;
      if (alpha >= 0.2 && node !== document.body) {
        node.setAttribute('data-menu-surface', '');
        return;
      }
    }
  });
  return page.locator('[data-menu-surface]');
};

type Opened = { surface: Locator; text: Locator; close: () => Promise<void> };

const SURFACES: Record<string, { size: typeof DESKTOP; open: (page: Page) => Promise<Opened> }> = {
  'message-menu': {
    size: DESKTOP,
    open: async (page) => {
      const row = page.locator('[data-message-id]').filter({ hasText: '16. ' }).last();
      // The toolbar's More Options opens the menu a right click opens (WebKit gets no right click).
      await row.hover();
      await row.getByRole('button', { name: 'More Options', exact: true }).click();
      const entry = page
        .getByRole('menuitem', { name: 'Reply in Thread', exact: true })
        .filter({ hasText: 'Reply in Thread' });
      await expect(entry).toBeVisible();
      return {
        surface: await surfaceOf(page, entry),
        text: entry,
        close: () => page.keyboard.press('Escape'),
      };
    },
  },
  'room-header-menu': {
    size: DESKTOP,
    open: async (page) => {
      const more = page
        .locator('header')
        .filter({ hasText: ROOM })
        .getByRole('button', { name: 'More Options', exact: true });
      const entry = page.getByRole('menuitem', { name: 'Room Settings', exact: true });
      // A click while the room is still settling can land before the menu listens; try again.
      await expect(async () => {
        if (!(await entry.isVisible())) await more.click();
        await expect(entry).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 15_000 });
      return {
        surface: await surfaceOf(page, entry),
        text: entry,
        close: () => page.keyboard.press('Escape'),
      };
    },
  },
  'command-palette': {
    size: DESKTOP,
    open: async (page) => {
      await pressPaletteShortcut(page);
      const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
      await palette.getByRole('combobox').fill('Project');
      const option = palette.getByRole('option').first();
      await expect(option).toBeVisible();
      return {
        surface: await surfaceOf(page, palette),
        text: option,
        close: () => page.keyboard.press('Escape'),
      };
    },
  },
  'phone-composer-menu': {
    size: PHONE,
    open: async (page) => {
      await page.getByRole('button', { name: 'More actions', exact: true }).click();
      const menu = page.getByRole('menu', { name: 'More actions' });
      const entry = menu.getByRole('menuitemcheckbox', { name: 'Formatting' });
      await expect(entry).toBeVisible();
      return {
        surface: await surfaceOf(page, menu),
        text: entry,
        close: () => page.keyboard.press('Escape'),
      };
    },
  },
};

const checkSurfaces = async (page: Page, prefix: string, browser: string, testInfo: TestInfo) => {
  const roomId = await signIn(page, prefix);
  const measured: Record<string, Awaited<ReturnType<typeof surfaceShowThrough>>> = {};
  try {
    for (const theme of ['dark', 'light']) {
      for (const [name, { size, open }] of Object.entries(SURFACES)) {
        /* eslint-disable no-await-in-loop -- one surface after the other on one page. */
        await openRoom(page, roomId, `${theme}-theme`, size);
        const { surface, text, close } = await open(page);
        await page.mouse.move(0, 0);
        // Menus fade and slide in.
        await page.waitForTimeout(400);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${browser}-${name}-${theme}.png` });
        measured[`${name}-${theme}`] = await surfaceShowThrough(page, surface, text);
        await surface.evaluate((element) => element.removeAttribute('data-menu-surface'));
        await close();
        /* eslint-enable no-await-in-loop */
      }
    }
  } finally {
    const body = JSON.stringify(measured, null, 2);
    await writeFile(testInfo.outputPath(`surfaces-${browser}.json`), body);
    await testInfo.attach(`surfaces-${browser}.json`, { body });
  }
  // Playwright's WebKit draws the room's text over the menus (and the header and composer) unblurred,
  // so it shows through more there: 51 to 80 before the tint went up, 25 or 26 after.
  const limit = browser === 'webkit' ? 30 : 16;
  for (const [name, { alpha, spread, contrast }] of Object.entries(measured)) {
    expect.soft(alpha, `${name}: tint`).toBeGreaterThanOrEqual(0.85);
    expect.soft(spread, `${name}: the page behind shows only faintly`).toBeLessThanOrEqual(limit);
    expect.soft(contrast, `${name}: labels against what shows through`).toBeGreaterThanOrEqual(4.5);
  }
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

test('menus and dialogs hide the room behind them', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await checkSurfaces(page, 'menu_surfaces', 'chromium', testInfo);
});

test('menus and dialogs hide the room behind them (WebKit)', async ({ baseURL }, testInfo) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ viewport: DESKTOP, baseURL });
    await checkSurfaces(await context.newPage(), 'menu_surfaces_webkit', 'webkit', testInfo);
  } finally {
    await browser.close();
  }
});
