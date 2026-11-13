import { expect, test, type Locator, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, matrixFetch } from '../helpers/matrix';
import { launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The Settings dialog's `/` key: it moves focus to the search field over the menu while nothing
// that takes text has the focus, and types a slash like any other character while a text field
// has it. Checked in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in
// WebKit. Set SETTINGS_POLISH_SHOTS=<directory> to also save the dialog in dark and light themes,
// at a phone's width, with search results and with an Advanced fold open.
const PASSWORD = 'settings-polish-spec-password';
const SHOTS = process.env.SETTINGS_POLISH_SHOTS;
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const ROOMS = ['Design studio', 'Helper agent', 'Team updates'];

test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

/** A fresh account named Alice with a few rooms, signed in on `page`. */
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
  for (const name of ROOMS) {
    roomIds.push(
      // eslint-disable-next-line no-await-in-loop -- the rooms list in creation order.
      await createPrivateRoom(HOMESERVER, accessToken, { name, topic: `${name} for the team` })
    );
  }
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  return roomIds;
};

const dialogOf = (page: Page) => page.getByRole('dialog', { name: 'Settings' });
const searchField = (dialog: Locator) =>
  dialog.getByRole('combobox', { name: 'Search settings', exact: true });
const menuButton = (dialog: Locator, name: string) =>
  dialog.getByRole('navigation', { name: 'Settings' }).getByRole('button', { name, exact: true });
const setting = (dialog: Locator, id: string) => dialog.locator(`[data-setting-id="${id}"]`);

const openSettings = async (page: Page) => {
  await chooseFromAccountMenu(page, 'Settings');
  const dialog = dialogOf(page);
  await expect(dialog).toBeVisible();
  return dialog;
};

/** The `/` key with nothing focused, from a switch, and in two text fields. */
const exerciseSlash = async (page: Page) => {
  const dialog = await openSettings(page);
  const field = searchField(dialog);
  await expect(field).not.toBeFocused();

  // Nothing focused yet: the key goes to the search field and types nothing.
  await page.keyboard.press('/');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('');

  // From a switch, which takes no text, as well.
  const systemTheme = setting(dialog, 'systemTheme').getByRole('switch');
  const wasOn = await systemTheme.isChecked();
  await systemTheme.focus();
  await page.keyboard.press('/');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('');
  await expect(systemTheme).toBeChecked({ checked: wasOn });

  // In the search field the key is a character like any other.
  await field.pressSequentially('a/b');
  await expect(field).toHaveValue('a/b');
  await expect(field).toBeFocused();
  await field.fill('');

  // In another text field it types a slash there and focus stays.
  await menuButton(dialog, 'Privacy & security').click();
  const blocked = setting(dialog, 'blockedUsers').getByRole('textbox');
  await blocked.click();
  await page.keyboard.press('/');
  await expect(blocked).toBeFocused();
  await expect(blocked).toHaveValue('/');
  await expect(field).toHaveValue('');
};

type Viewport = { width: number; height: number };

/** Stores the theme, reloads Home at the size and opens Settings. */
const openThemed = async (page: Page, themeId: string, viewport: Viewport) => {
  await page.setViewportSize(viewport);
  await page.evaluate((id) => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
    localStorage.setItem(
      'settings',
      JSON.stringify({ ...settings, useSystemTheme: false, themeId: id })
    );
  }, themeId);
  await page.goto('/home/');
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText('Team updates').first()).toBeVisible();
  return openSettings(page);
};

/** Opens Settings in the theme and at the size, shows `show` and saves the window. */
const shoot = async (
  page: Page,
  themeId: string,
  viewport: Viewport,
  file: string,
  show: (dialog: Locator) => Promise<void>
) => {
  await openThemed(page, themeId, viewport);
  // On a phone the page that covers the menu may rename the dialog; it is the only one.
  await show(page.getByRole('dialog'));
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await page.mouse.move(0, 0);
  // The dialog slides in for 200 ms.
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${file}` });
};

/** The Theme card up close, the pointer resting on where System Theme applies. */
const shootScope = async (page: Page, themeId: string, file: string) => {
  const dialog = await openThemed(page, themeId, DESKTOP);
  await setting(dialog, 'systemTheme').locator('[data-setting-scope]').hover();
  // Tooltips open after a short delay.
  await page.waitForTimeout(800);
  const card = (await dialog.locator('[data-sequence-card]').first().boundingBox())!;
  const clip = { x: card.x - 24, y: card.y - 56, width: card.width + 48, height: card.height + 96 };
  await page.screenshot({ path: `${SHOTS}/${file}`, clip });
};

/** The menu up close with the keyboard's focus on Chats, then a room's settings. */
const shootFocusAndRoom = async (page: Page, theme: 'dark' | 'light', roomId: string) => {
  const dialog = await openThemed(page, `${theme}-theme`, DESKTOP);
  await menuButton(dialog, 'Appearance').click();
  await page.keyboard.press('Tab');
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  const clip = (await dialog.getByRole('navigation', { name: 'Settings' }).boundingBox())!;
  await page.screenshot({ path: `${SHOTS}/menu-focus-${theme}.png`, clip });
  await page.keyboard.press('Escape');
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await page.locator('header').filter({ hasText: ROOMS[0] }).getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Room Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'General', exact: true })).toBeVisible();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/room-settings-${theme}.png` });
};

const appearance = async (dialog: Locator) => {
  await expect(setting(dialog, 'systemTheme')).toBeVisible();
};
const chats = async (dialog: Locator) => {
  await menuButton(dialog, 'Chats').click();
  await expect(setting(dialog, 'enterForNewline')).toBeVisible();
};

type RowMetrics = {
  label: string;
  height: number;
  /** From the row's start edge to its icon, and from the icon to the name. */
  edge: number;
  iconGap: number;
  /** Space to the next row of the same group, if any. */
  gapAfter: number | null;
  labelOpacity: number;
};

/** Each menu row's size and spacing, in CSS pixels, as laid out in `menu`. */
const measureMenuRows = (menu: Locator) =>
  menu.evaluate((element): RowMetrics[] =>
    [...element.querySelectorAll<HTMLElement>('button')].map((row) => {
      const box = row.getBoundingClientRect();
      const icon = row.querySelector('svg')!.getBoundingClientRect();
      const name = row.lastElementChild!;
      const next = row.nextElementSibling;
      return {
        label: name.textContent ?? '',
        height: box.height,
        edge: icon.left - box.left,
        iconGap: name.getBoundingClientRect().left - icon.right,
        gapAfter:
          next instanceof HTMLButtonElement ? next.getBoundingClientRect().top - box.bottom : null,
        labelOpacity: Number(getComputedStyle(name).opacity),
      };
    })
  );

/** The keyboard focus ring of `row`: its style, and how far it reaches past the row's edge. */
const focusRing = (row: Locator) =>
  row.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      style: style.outlineStyle,
      reach: parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth),
    };
  });

/**
 * The lines a settings page draws: under its title bar (a border or a 1 px pseudo-element) and
 * between the rows of its cards.
 */
const pageLines = (dialog: Locator) =>
  dialog.evaluate((element) => {
    // The page's title bar: the header outside the menu.
    const headers = [...element.querySelectorAll('header')].filter((h) => !h.closest('nav'));
    const drawn = (style: CSSStyleDeclaration) =>
      style.content !== 'none' && style.content !== 'normal' && parseFloat(style.height) <= 1;
    const lined = (header: Element) =>
      parseFloat(getComputedStyle(header).borderBottomWidth) > 0 ||
      drawn(getComputedStyle(header, '::after')) ||
      drawn(getComputedStyle(header, '::before'));
    const rows = [...element.querySelectorAll('[data-settings-page] [data-sequence-card] > *')];
    return {
      titleBar: headers.length > 0 ? headers.some(lined) : null,
      rows: rows.length,
      rowLines: rows.filter((row) => {
        const style = getComputedStyle(row);
        return parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderBottomWidth) > 0;
      }).length,
    };
  });

/** Checks the rows of a settings menu: 32 px tall, 4 px apart, 8 px to the icon, 8 px to the name. */
const expectMenuRows = (rows: RowMetrics[], open: string) => {
  expect(rows.length).toBeGreaterThan(3);
  for (const row of rows) {
    expect(row.height, row.label).toBeCloseTo(32, 0);
    expect(row.edge, row.label).toBeCloseTo(8, 0);
    expect(row.iconGap, row.label).toBeCloseTo(8, 0);
    if (row.gapAfter !== null) expect(row.gapAfter, row.label).toBeCloseTo(4, 0);
    // Only the open page reads in full color while the pointer is away.
    expect(row.labelOpacity, row.label).toBe(row.label === open ? 1 : 0.7);
  }
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

test('/ moves focus to the search field unless a text field has it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, 'settings_slash');
  await exerciseSlash(page);
});

test('/ moves focus to the search field unless a text field has it (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.slow();
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ viewport: DESKTOP, baseURL });
    const page = await context.newPage();
    await signIn(page, 'settings_slash_webkit');
    await exerciseSlash(page);
    if (SHOTS) {
      await shoot(page, 'dark-theme', DESKTOP, 'webkit-desktop-dark.png', appearance);
      await shoot(page, 'light-theme', PHONE, 'webkit-phone-page-light.png', chats);
    }
  } finally {
    await browser.close();
  }
});

test('the search field shows the / key, and the shortcut help lists it under Settings', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, 'settings_slash_hint');
  const dialog = await openSettings(page);
  const field = searchField(dialog);
  const hint = dialog.locator('kbd', { hasText: '/' });
  await expect(hint).toBeVisible();
  // The hint is decoration; the field's name stays "Search settings" and it names its key.
  await expect(hint).toHaveAttribute('aria-hidden', 'true');
  await expect(field).toHaveAttribute('aria-keyshortcuts', '/');
  // It makes way for the text once the field holds some.
  await field.fill('theme');
  await expect(hint).toBeHidden();
  await field.press('Escape');
  await field.press('Escape');
  await expect(dialog).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+/');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help).toBeVisible();
  await expect(help.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  const row = help.locator('[data-shortcut-row="settingsSearch"]');
  await expect(row).toContainText('Search settings');
  await expect(row.locator('kbd')).toHaveText('/');
});

/**
 * Measures both settings menus and their pages, checks them and returns what it measured. The
 * keyboard's focus ring is checked where Tab reaches buttons (`keyboard`; WebKit on a Mac skips
 * them).
 */
const checkSpacing = async (page: Page, prefix: string, keyboard: boolean) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const [roomId] = await signIn(page, prefix);
  const dialog = await openSettings(page);
  await page.mouse.move(0, 0);
  const nav = dialog.getByRole('navigation', { name: 'Settings' });
  const settingsRows = await measureMenuRows(nav.locator('[role="group"]').first().locator('..'));
  expectMenuRows(settingsRows, 'Appearance');

  // A click shows no ring; the keyboard's ring is drawn inside the row it marks.
  const appearance = menuButton(dialog, 'Appearance');
  await appearance.click();
  await page.mouse.move(0, 0);
  expect((await focusRing(appearance)).style).toBe('none');
  let ring: Awaited<ReturnType<typeof focusRing>> | undefined;
  if (keyboard) {
    await page.keyboard.press('Tab');
    const chats = menuButton(dialog, 'Chats');
    await expect(chats).toBeFocused();
    ring = await focusRing(chats);
    expect(ring.style).toBe('solid');
    expect(ring.reach).toBeLessThanOrEqual(0);
    const name = chats.locator('> :last-child');
    expect(await name.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  }

  const lines = await pageLines(dialog);
  expect(lines).toEqual({ titleBar: false, rows: lines.rows, rowLines: 0 });
  expect(lines.rows).toBeGreaterThan(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Room settings share the menu rows and the page frame.
  await page.goto(`/home/${encodeURIComponent(roomId!)}`);
  await page.locator('header').filter({ hasText: ROOMS[0] }).getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Room Settings', exact: true }).click();
  const general = page.getByRole('button', { name: 'General', exact: true });
  await expect(general).toBeVisible();
  await page.mouse.move(0, 0);
  const roomRows = await measureMenuRows(general.locator('..'));
  expectMenuRows(roomRows, 'General');
  const roomLines = await pageLines(page.getByRole('dialog'));
  expect(roomLines).toEqual({ titleBar: false, rows: roomLines.rows, rowLines: 0 });
  return { settingsRows, ring, lines, roomRows, roomLines };
};

test('menu rows are spaced apart, focus stays inside a row, and no lines divide the page', async ({
  page,
}, testInfo) => {
  const measured = await checkSpacing(page, 'settings_spacing', true);
  await testInfo.attach('spacing.json', { body: JSON.stringify(measured) });
});

test('menu rows are spaced apart and no lines divide the page (WebKit)', async ({
  baseURL,
}, testInfo) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.slow();
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ viewport: DESKTOP, baseURL });
    const measured = await checkSpacing(await context.newPage(), 'settings_spacing_webkit', false);
    await testInfo.attach('spacing-webkit.json', { body: JSON.stringify(measured) });
  } finally {
    await browser.close();
  }
});

test('screenshots of the Settings dialog', async ({ page }) => {
  test.skip(!SHOTS, 'Set SETTINGS_POLISH_SHOTS=<directory> to save the screenshots');
  // Every picture reloads the app and opens Settings again.
  test.setTimeout(480_000);
  const [roomId] = await signIn(page, 'settings_polish');

  await shoot(page, 'dark-theme', DESKTOP, 'desktop-dark.png', appearance);
  await shoot(page, 'light-theme', DESKTOP, 'desktop-light.png', appearance);
  await shoot(
    page,
    'dark-theme',
    { width: 1280, height: 800 },
    'desktop-dark-1280.png',
    appearance
  );
  await shoot(page, 'dark-theme', DESKTOP, 'chats-dark.png', chats);
  await shoot(page, 'light-theme', DESKTOP, 'sidebar-light.png', async (dialog) => {
    await menuButton(dialog, 'Sidebar').click();
    await expect(setting(dialog, 'sidebarThreads')).toBeVisible();
  });
  await shoot(page, 'dark-theme', DESKTOP, 'search-dark.png', async (dialog) => {
    await searchField(dialog).fill('theme');
    await expect(dialog.getByRole('option').first()).toBeVisible();
  });
  await shoot(page, 'dark-theme', DESKTOP, 'advanced-dark.png', async (dialog) => {
    await dialog.getByRole('button', { name: 'Advanced', exact: true }).click();
    await expect(setting(dialog, 'messageSpacing')).toBeVisible();
  });
  await shoot(page, 'light-theme', DESKTOP, 'privacy-advanced-light.png', async (dialog) => {
    await menuButton(dialog, 'Privacy & security').click();
    await expect(setting(dialog, 'blockedUsers')).toBeVisible();
  });
  await shoot(page, 'dark-theme', PHONE, 'phone-menu-dark.png', async (dialog) => {
    await expect(menuButton(dialog, 'Appearance')).toBeVisible();
  });
  await shoot(page, 'dark-theme', PHONE, 'phone-page-dark.png', async (dialog) => {
    await menuButton(dialog, 'Appearance').click();
    await expect(setting(dialog, 'systemTheme')).toBeVisible();
  });
  await shoot(page, 'light-theme', PHONE, 'phone-page-light.png', chats);
  await shootScope(page, 'dark-theme', 'scope-dark.png');
  await shootScope(page, 'light-theme', 'scope-light.png');

  await shootFocusAndRoom(page, 'dark', roomId!);
  await shootFocusAndRoom(page, 'light', roomId!);

  // Right to left: Arabic mirrors the menu, the title bar and the rows. ⌘, or Ctrl+, opens
  // Settings in any language.
  await page.evaluate(() => {
    localStorage.setItem('i18nextLng', 'ar');
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
    localStorage.setItem('settings', JSON.stringify({ ...settings, themeId: 'dark-theme' }));
  });
  await page.setViewportSize(DESKTOP);
  await page.goto('/home/');
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText('Team updates').first()).toBeVisible();
  await page.keyboard.press('ControlOrMeta+,');
  await expect(page.getByRole('dialog').locator('[data-setting-id="systemTheme"]')).toBeVisible();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/rtl-dark.png` });
  await page.evaluate(() => localStorage.setItem('i18nextLng', 'en'));
});
