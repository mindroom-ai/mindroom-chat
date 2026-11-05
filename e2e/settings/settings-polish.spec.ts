import { expect, test, webkit, type Locator, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, matrixFetch } from '../helpers/matrix';

// The Settings dialog's `/` key: it moves focus to the search field over the menu while nothing
// that takes text has the focus, and types a slash like any other character while a text field
// has it. Checked in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in
// WebKit. Set SETTINGS_POLISH_SHOTS=<directory> to also save the dialog in dark and light themes,
// at a phone's width, with search results and with an Advanced fold open.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
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
  for (const name of ROOMS) {
    // eslint-disable-next-line no-await-in-loop -- the rooms list in creation order.
    await createPrivateRoom(HOMESERVER, accessToken, { name, topic: `${name} for the team` });
  }
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
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

const appearance = async (dialog: Locator) => {
  await expect(setting(dialog, 'systemTheme')).toBeVisible();
};
const chats = async (dialog: Locator) => {
  await menuButton(dialog, 'Chats').click();
  await expect(setting(dialog, 'enterForNewline')).toBeVisible();
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
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
  const browser = await webkit.launch({ executablePath: WEBKIT, args: [] });
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

test('screenshots of the Settings dialog', async ({ page }) => {
  test.skip(!SHOTS, 'Set SETTINGS_POLISH_SHOTS=<directory> to save the screenshots');
  // Every picture reloads the app and opens Settings again.
  test.setTimeout(420_000);
  await signIn(page, 'settings_polish');

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
