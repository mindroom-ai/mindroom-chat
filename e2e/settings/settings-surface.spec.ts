import { expect, test, webkit, type Locator, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { contrastRatio, sampleScreenshot, type Rgba } from '../helpers/glassVisual';
import { createPrivateRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';

// The Settings dialog over a busy room: its menu column is inset evenly (the search field, the
// group headings, the rows and Logout leave as much space at the dialog's edge as at the divider
// beside the page), and its surface is nearly opaque, so the room behind it shows only as a faint
// blur and the menu's names keep their contrast. Checked in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set
// SETTINGS_SURFACE_SHOTS=<directory> to also save the dialog and the other large dialogs.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'settings-surface-spec-password';
const SHOTS = process.env.SETTINGS_SURFACE_SHOTS;
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const ROOM_COUNT = 26;
const MESSAGE =
  'The weekly planning notes are ready: we moved the launch review to Thursday, the design team ' +
  'shared three new layouts for the onboarding flow, and the support queue is down to twelve open ' +
  'requests after the release. Please read the summary before the call and add your questions.';

test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

/** A fresh account with 26 rooms, the first full of long messages, signed in on `page`. */
const signIn = async (page: Page, prefix: string) => {
  const username = `${prefix}_${Date.now().toString(36)}`;
  const { access_token: accessToken, user_id: userId } = await matrixFetch<{
    access_token: string;
    user_id: string;
  }>(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(userId)}/displayname`, {
    method: 'PUT',
    accessToken,
    body: JSON.stringify({ displayname: 'Alice' }),
  });
  const roomIds: string[] = [];
  for (let index = 0; index < ROOM_COUNT; index += 1) {
    roomIds.push(
      // eslint-disable-next-line no-await-in-loop -- the rooms list in creation order.
      await createPrivateRoom(HOMESERVER, accessToken, {
        name: `Project room ${index + 1}`,
        topic: `Planning and updates for project ${index + 1}`,
      })
    );
  }
  for (let index = 0; index < 16; index += 1) {
    // eslint-disable-next-line no-await-in-loop -- the timeline in order.
    await sendRoomMessage(HOMESERVER, accessToken, roomIds[0]!, {
      msgtype: 'm.text',
      body: `${index + 1}. ${MESSAGE}`,
    });
  }
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  return roomIds[0]!;
};

type Viewport = { width: number; height: number };

/**
 * Stores the theme, opens the busy room at the size (a phone's room list, where the account
 * button is), then Settings with its Account page in the menu.
 */
const openAccount = async (page: Page, roomId: string, themeId: string, viewport: Viewport) => {
  const phone = viewport.width < 600;
  await page.setViewportSize(viewport);
  await page.evaluate((id) => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
    localStorage.setItem(
      'settings',
      JSON.stringify({ ...settings, useSystemTheme: false, themeId: id })
    );
  }, themeId);
  await page.goto(phone ? '/home/' : `/home/${encodeURIComponent(roomId)}`);
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  const busy = phone
    ? page.getByText('Project room 9', { exact: true })
    : page.getByText(MESSAGE.slice(0, 40));
  await expect(busy.last()).toBeVisible();
  await chooseFromAccountMenu(page, 'Settings');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  const account = dialog
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('button', { name: 'Account', exact: true });
  await expect(account).toBeVisible();
  return { dialog, account };
};

type Inset = { part: string; start: number; end: number };

/**
 * How far each part of the menu column stays from the dialog's start edge and from the divider
 * (on a phone, which has none, from the dialog's end edge), in CSS pixels.
 */
const menuInsets = (dialog: Locator) =>
  dialog.evaluate((element): Inset[] => {
    const nav = element.querySelector('nav')!;
    const next = nav.nextElementSibling?.getBoundingClientRect();
    const dialogBox = element.getBoundingClientRect();
    const end = next && next.width <= 2 ? next.left : dialogBox.right;
    const field = nav.querySelector('[role="combobox"]')!.parentElement!;
    const headings = [...nav.querySelectorAll('[role="group"] > :first-child')];
    const rows = [...nav.querySelectorAll('button:not([aria-label])')];
    return [field, ...headings, ...rows].map((part) => {
      const box = part.getBoundingClientRect();
      return {
        part: part === field ? 'search' : part.textContent ?? '',
        start: box.left - dialogBox.left,
        end: end - box.right,
      };
    });
  });

const expectEvenInsets = (insets: Inset[]) => {
  expect(insets.length).toBeGreaterThan(10);
  for (const { part, start, end } of insets) {
    expect.soft(Math.abs(start - end), `${part}: ${start} vs ${end}`).toBeLessThanOrEqual(1);
    // 8 px from the column's edge, plus the dialog's 1 px rim where it has one.
    expect.soft(start, part).toBeGreaterThanOrEqual(7.5);
    expect.soft(start, part).toBeLessThanOrEqual(9.5);
  }
};

/** The dialog's own background: its alpha and its backdrop filters. */
const surfaceOf = (dialog: Locator) =>
  dialog.evaluate((element) => {
    const style = getComputedStyle(element);
    const numbers = style.backgroundColor.match(/[\d.]+/g)!.map(Number);
    let alpha = 1;
    if (style.backgroundColor.includes('/')) alpha = numbers[numbers.length - 1]!;
    else if (style.backgroundColor.startsWith('rgba')) alpha = numbers[3]!;
    return {
      background: style.backgroundColor,
      alpha,
      // A dialog with a flat title bar blurs the page in its ::after layer instead.
      filter: [style, getComputedStyle(element, '::after')]
        .map((css) => css.backdropFilter || css.getPropertyValue('-webkit-backdrop-filter'))
        .join(' '),
    };
  });

/**
 * The dialog's surface over the menu column with everything in the dialog hidden: how much the
 * room behind it varies (brightness spread, 0 to 255) and the lowest contrast a quiet menu name
 * (at its 0.7 opacity) has against any point of it.
 */
const menuBackdrop = async (page: Page, dialog: Locator, account: Locator) => {
  const quietName = dialog
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('button', { name: 'Notifications', exact: true })
    .locator('> :last-child');
  const label = await quietName.evaluate((element) => {
    const numbers = getComputedStyle(element)
      .color.match(/[\d.]+/g)!
      .map(Number);
    return [numbers[0]!, numbers[1]!, numbers[2]!, Number(getComputedStyle(element).opacity)];
  });
  const column = (await account.locator('xpath=ancestor::nav[1]').boundingBox())!;
  await dialog.evaluate((element) => element.setAttribute('data-surface-probe', ''));
  const hide = await page.addStyleTag({
    content: '[data-surface-probe] * { visibility: hidden !important; }',
  });
  let pixels: Rgba[];
  try {
    const points: Array<{ x: number; y: number }> = [];
    for (let y = column.y + 12; y < column.y + column.height - 12; y += 6) {
      for (let x = column.x + 12; x < column.x + column.width - 12; x += 6) points.push({ x, y });
    }
    pixels = await sampleScreenshot(page, points);
  } finally {
    await hide.evaluate((element) => element.remove());
    await dialog.evaluate((element) => element.removeAttribute('data-surface-probe'));
  }
  const brightness = pixels.map(([red, green, blue]) => (red + green + blue) / 3);
  return {
    spread: Math.max(...brightness) - Math.min(...brightness),
    contrast: Math.min(...pixels.map((pixel) => contrastRatio(label as Rgba, pixel))),
  };
};

/** Checks the Account page's menu insets and surface in both themes, and the phone's menu. */
const checkSurface = async (
  page: Page,
  prefix: string,
  attach: (body: string) => Promise<void>
) => {
  const roomId = await signIn(page, prefix);
  const measured: Record<string, unknown> = {};
  try {
    for (const theme of ['dark-theme', 'light-theme']) {
      // eslint-disable-next-line no-await-in-loop -- one theme after the other on one page.
      const { dialog, account } = await openAccount(page, roomId, theme, DESKTOP);
      await account.click();
      await page.mouse.move(0, 0);
      // The dialog slides in for 200 ms.
      await page.waitForTimeout(400);
      /* eslint-disable no-await-in-loop -- one theme after the other on one page. */
      const insets = await menuInsets(dialog);
      const surface = await surfaceOf(dialog);
      const backdrop = await menuBackdrop(page, dialog, account);
      /* eslint-enable no-await-in-loop */
      measured[theme] = { insets, surface, backdrop };
      expectEvenInsets(insets);
      expect.soft(surface.filter, theme).toContain('blur(');
      expect.soft(surface.alpha, theme).toBeGreaterThanOrEqual(0.9);
      expect.soft(backdrop.contrast, theme).toBeGreaterThanOrEqual(4.5);
      expect.soft(backdrop.spread, theme).toBeLessThanOrEqual(16);
    }
    const { dialog } = await openAccount(page, roomId, 'dark-theme', PHONE);
    const phoneInsets = await menuInsets(dialog);
    measured.phone = phoneInsets;
    expectEvenInsets(phoneInsets);
  } finally {
    await attach(JSON.stringify(measured, null, 2));
  }
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

test('the Settings menu is inset evenly and its surface hides the room behind it', async ({
  page,
}, testInfo) => {
  test.slow();
  await checkSurface(page, 'settings_surface', (body) => testInfo.attach('surface.json', { body }));
});

test('the Settings menu is inset evenly and its surface hides the room behind it (WebKit)', async ({
  baseURL,
}, testInfo) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.slow();
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await webkit.launch({ executablePath: WEBKIT, args: [] });
  try {
    const context = await browser.newContext({ viewport: DESKTOP, baseURL });
    await checkSurface(await context.newPage(), 'settings_surface_webkit', (body) =>
      testInfo.attach('surface-webkit.json', { body })
    );
  } finally {
    await browser.close();
  }
});

const settle = async (page: Page) => {
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
};

test('screenshots of the Settings dialog over a busy room', async ({ page }) => {
  test.skip(!SHOTS, 'Set SETTINGS_SURFACE_SHOTS=<directory> to save the screenshots');
  test.setTimeout(300_000);
  const roomId = await signIn(page, 'settings_surface_shots');
  for (const theme of ['dark', 'light']) {
    /* eslint-disable no-await-in-loop -- one picture after the other on one page. */
    let { dialog, account } = await openAccount(page, roomId, `${theme}-theme`, DESKTOP);
    await account.click();
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/desktop-account-${theme}.png` });
    const column = (await account.locator('xpath=ancestor::nav[1]').boundingBox())!;
    await page.screenshot({
      path: `${SHOTS}/desktop-menu-${theme}.png`,
      clip: { ...column, width: column.width + 40 },
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    ({ dialog, account } = await openAccount(page, roomId, `${theme}-theme`, PHONE));
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/phone-menu-${theme}.png` });
    await account.click();
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/phone-account-${theme}.png` });

    // The other large dialogs share the surface: room settings and the shortcut help.
    await page.setViewportSize(DESKTOP);
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    await expect(page.getByText(MESSAGE.slice(0, 40)).last()).toBeVisible();
    await page
      .locator('header')
      .filter({ hasText: 'Project room 1' })
      .getByRole('button')
      .last()
      .click();
    await page.getByRole('button', { name: 'Room Settings', exact: true }).click();
    await expect(page.getByRole('button', { name: 'General', exact: true })).toBeVisible();
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/room-settings-${theme}.png` });
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+/');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/shortcuts-${theme}.png` });
    await page.keyboard.press('Escape');
    /* eslint-enable no-await-in-loop */
  }
});
