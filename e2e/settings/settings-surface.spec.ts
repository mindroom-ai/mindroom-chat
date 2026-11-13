import { expect, test, type Locator, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { surfaceShowThrough } from '../helpers/surfaceShowThrough';
import { createPrivateRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The Settings dialog over a busy room: its menu column is inset evenly (the search field, the
// group headings, the rows and Logout leave as much space at the dialog's edge as at the divider
// beside the page), the search field keeps at least that much space from the dialog's top edge, in
// line with the page's title bar beside it, and its surface is nearly opaque, so the room behind
// it shows only as a faint blur and the menu's names keep their contrast. Checked in Chromium and,
// when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set
// SETTINGS_SURFACE_SHOTS=<directory> to also save the dialog and the other large dialogs.
const PASSWORD = 'settings-surface-spec-password';
const SHOTS = process.env.SETTINGS_SURFACE_SHOTS;
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
    // Inside the dialog's 1 px border.
    const start = element.getBoundingClientRect().left + element.clientLeft;
    const end = next && next.width <= 2 ? next.left : start + element.clientWidth;
    const field = nav.querySelector('[role="combobox"]')!.parentElement!;
    const headings = [...nav.querySelectorAll('[role="group"] > :first-child')];
    const rows = [...nav.querySelectorAll('button:not([aria-label])')];
    return [field, ...headings, ...rows].map((part) => {
      const box = part.getBoundingClientRect();
      return {
        part: part === field ? 'search' : part.textContent ?? '',
        start: box.left - start,
        end: end - box.right,
      };
    });
  });

const expectEvenInsets = (insets: Inset[]) => {
  expect(insets.length).toBeGreaterThan(10);
  for (const { part, start, end } of insets) {
    expect.soft(Math.abs(start - end), `${part}: ${start} vs ${end}`).toBeLessThanOrEqual(1);
    expect.soft(start, part).toBeCloseTo(12, 0);
  }
};

type HeaderLine = {
  /** The search field's distance from the dialog's top edge and from its start edge. */
  topGap: number;
  sideInset: number;
  /** From the field's bottom to the first group heading of the menu. */
  belowGap: number;
  /** Vertical centers of the field, the page's title and its close button. */
  field: number;
  title: number;
  close: number;
  /** Heights of the search field's header and of the page's title bar. */
  searchBar: number;
  titleBar: number;
};

/**
 * Where the search field sits on top of the menu, beside the open page's title bar, in CSS pixels
 * (wide screens, where the page and the menu are side by side).
 */
const headerLine = (dialog: Locator) =>
  dialog.evaluate((element): HeaderLine => {
    const dialogBox = element.getBoundingClientRect();
    // Inside the dialog's 1 px border.
    const top = dialogBox.top + element.clientTop;
    const start = dialogBox.left + element.clientLeft;
    const input = element.querySelector('[role="combobox"]')!;
    const field = input.parentElement!.getBoundingClientRect();
    const searchBar = input.closest('header')!.getBoundingClientRect();
    const heading = element
      .querySelector('nav [role="group"] > :first-child')!
      .getBoundingClientRect();
    const title = element.querySelector('[data-dialog-title]')!;
    const titleBar = title.closest('header')!;
    const close = titleBar.querySelector('button')!.getBoundingClientRect();
    const center = (box: DOMRect) => box.top + box.height / 2;
    return {
      topGap: field.top - top,
      sideInset: field.left - start,
      belowGap: heading.top - field.bottom,
      field: center(field),
      title: center(title.getBoundingClientRect()),
      close: center(close),
      searchBar: searchBar.height,
      titleBar: titleBar.getBoundingClientRect().height,
    };
  });

const expectHeaderLine = (line: HeaderLine, theme: string) => {
  expect
    .soft(line.topGap, `${theme}: gap above the search field`)
    .toBeGreaterThanOrEqual(line.sideInset - 0.5);
  expect.soft(Math.abs(line.searchBar - line.titleBar), `${theme}: header heights`).toBeLessThan(1);
  expect
    .soft(Math.abs(line.field - line.title), `${theme}: field and title`)
    .toBeLessThanOrEqual(1);
  expect
    .soft(Math.abs(line.field - line.close), `${theme}: field and close`)
    .toBeLessThanOrEqual(1);
};

/**
 * The dialog's own background: its color, alpha and backdrop filters, and the search field's
 * fill, which must not be the surface's own color.
 */
const surfaceOf = (dialog: Locator) =>
  dialog.evaluate((element) => {
    const style = getComputedStyle(element);
    const field = element.querySelector('[role="combobox"]')!.parentElement!;
    const numbers = style.backgroundColor.match(/[\d.]+/g)!.map(Number);
    let alpha = 1;
    if (style.backgroundColor.includes('/')) alpha = numbers[numbers.length - 1]!;
    else if (style.backgroundColor.startsWith('rgba')) alpha = numbers[3]!;
    return {
      background: style.backgroundColor,
      rgb: numbers.slice(0, 3).map((channel) => Math.round(channel <= 1 ? channel * 255 : channel)),
      field: getComputedStyle(field).backgroundColor,
      alpha,
      // A dialog with a flat title bar blurs the page in its ::after layer instead.
      filter: [style, getComputedStyle(element, '::after')]
        .map((css) => css.backdropFilter || css.getPropertyValue('-webkit-backdrop-filter'))
        .join(' '),
    };
  });

/**
 * The dialog's surface over the menu column: how much the room behind shows through, and the
 * lowest contrast a quiet menu name (at its 0.7 opacity) has against it.
 */
const menuBackdrop = (dialog: Locator, account: Locator) =>
  surfaceShowThrough(
    dialog.page(),
    dialog,
    dialog
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: 'Notifications', exact: true })
      .locator('> :last-child'),
    account.locator('xpath=ancestor::nav[1]')
  );

/**
 * Checks the Account page's menu insets, search field and surface in both themes, and the phone's
 * menu; with SETTINGS_SURFACE_SHOTS set, saves the dialog in each theme, named after `shots`.
 */
const checkSurface = async (
  page: Page,
  prefix: string,
  attach: (body: string) => Promise<void>,
  shots: string
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
      const line = await headerLine(dialog);
      const surface = await surfaceOf(dialog);
      const backdrop = await menuBackdrop(dialog, account);
      if (SHOTS) {
        const box = (await dialog.boundingBox())!;
        await page.screenshot({
          path: `${SHOTS}/desktop-dialog-${shots}-${theme}.png`,
          clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 },
        });
      }
      /* eslint-enable no-await-in-loop */
      measured[theme] = { insets, line, surface, backdrop };
      expectEvenInsets(insets);
      expectHeaderLine(line, theme);
      // A blur, or the liquid glass filter where the browser draws it.
      expect.soft(surface.filter, theme).toMatch(/blur\(|url\(/);
      expect.soft(surface.alpha, theme).toBeGreaterThanOrEqual(0.9);
      expect.soft(surface.field, theme).not.toBe(`rgb(${surface.rgb.join(', ')})`);
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
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

test('the Settings menu is inset evenly and its surface hides the room behind it', async ({
  page,
}, testInfo) => {
  test.slow();
  await checkSurface(
    page,
    'settings_surface',
    (body) => testInfo.attach('surface.json', { body }),
    'chromium'
  );
});

test('the Settings menu is inset evenly and its surface hides the room behind it (WebKit)', async ({
  baseURL,
}, testInfo) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.slow();
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ viewport: DESKTOP, baseURL });
    await checkSurface(
      await context.newPage(),
      'settings_surface_webkit',
      (body) => testInfo.attach('surface-webkit.json', { body }),
      'webkit'
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
    await page.getByRole('menuitem', { name: 'Room Settings', exact: true }).click();
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
