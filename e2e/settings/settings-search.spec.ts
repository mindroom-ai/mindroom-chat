import { expect, test, type Locator, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { matrixFetch } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The Settings dialog built from the settings registry: its menu under group headings, the
// search field over it, the Advanced fold a search opens, `/settings/<page>` with an earlier
// page id, and the phone layout. Set SETTINGS_SHOTS=<directory> to also save it in dark and light
// themes, at a phone's width, and with search results.
const PASSWORD = 'settings-search-spec-password';
const SHOTS = process.env.SETTINGS_SHOTS;

const GROUPS = ['You', 'This app', 'Agents & connections', 'Rooms', 'Help & advanced'];
const PAGES = [
  'Account',
  'Notifications',
  'Privacy & security',
  'Appearance',
  'Chats',
  'Sidebar',
  'Language & region',
  'Connected accounts',
  'Computers',
  'Archived Rooms',
  'Storage & offline',
  'Developer Tools',
  'About',
];

/** A fresh account, signed in on `page`. */
const signIn = async (page: Page, prefix: string) => {
  const username = `${prefix}_${Date.now().toString(36)}`;
  await matrixFetch(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
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

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

test('Settings opens on Appearance with its pages under group headings', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, 'settings_menu');
  const dialog = await openSettings(page);

  for (const group of GROUPS) {
    await expect(dialog.getByRole('heading', { name: group, exact: true })).toBeVisible();
  }
  const nav = dialog.getByRole('navigation', { name: 'Settings' });
  await expect(nav.getByRole('group')).toHaveCount(GROUPS.length);
  for (const name of PAGES) await expect(menuButton(dialog, name)).toBeVisible();
  // General is gone; Appearance opens first and says where its settings apply.
  await expect(menuButton(dialog, 'General')).toHaveCount(0);
  await expect(menuButton(dialog, 'Appearance')).toHaveAttribute('aria-pressed', 'true');
  await expect(setting(dialog, 'systemTheme')).toContainText('This device');

  await menuButton(dialog, 'Sidebar').click();
  await expect(setting(dialog, 'sidebarThreads')).toContainText('Your account (all devices)');
});

test('searching "24-hour" lands on Language & region with the setting highlighted', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, 'settings_hour');
  const dialog = await openSettings(page);
  const field = searchField(dialog);

  await field.fill('24-hour');
  const results = dialog.getByRole('listbox', { name: 'Search results' });
  const first = results.getByRole('option').first();
  await expect(first).toContainText('24-Hour Time Format');
  await expect(first).toContainText('Language & region › Date & Time');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await expect(field).toHaveAttribute('aria-activedescendant', (await first.getAttribute('id'))!);
  // The menu gives way to the results while the field holds text.
  await expect(menuButton(dialog, 'Account')).toHaveCount(0);

  await field.press('Enter');
  await expect(dialog.locator('header').filter({ hasText: 'Language & region' })).toBeVisible();
  const clock = setting(dialog, 'hour24Clock');
  await expect(clock).toHaveAttribute('data-settings-highlight', '');
  await expect(clock).toBeInViewport();
  await expect(clock.getByRole('switch')).toBeFocused();
  await expect(clock).toContainText('Your account (all devices)');
  await expect(clock).not.toHaveAttribute('data-settings-highlight', '', { timeout: 5_000 });

  // Escape empties the field and brings the menu back; a second one closes the dialog.
  await field.focus();
  await field.press('Escape');
  await expect(field).toHaveValue('');
  await expect(menuButton(dialog, 'Account')).toBeVisible();
  await field.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('a search result in an Advanced fold opens the fold; arrow keys move through results', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, 'settings_fold');
  const dialog = await openSettings(page);
  const field = searchField(dialog);
  await menuButton(dialog, 'Appearance').click();
  const fold = dialog.getByRole('button', { name: 'Advanced', exact: true });
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(setting(dialog, 'messageSpacing')).toHaveCount(0);

  await field.fill('spacing');
  const results = dialog.getByRole('listbox', { name: 'Search results' }).getByRole('option');
  await expect(results.first()).toContainText('Message Spacing');
  await expect(results.first()).toContainText('Appearance › Display › Advanced');

  await field.fill('theme');
  await expect(results.nth(1)).toBeVisible();
  await field.press('ArrowDown');
  await expect(results.nth(1)).toHaveAttribute('aria-selected', 'true');
  await field.press('ArrowUp');
  await expect(results.first()).toHaveAttribute('aria-selected', 'true');

  await field.fill('message spacing');
  await field.press('Enter');
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  const spacing = setting(dialog, 'messageSpacing');
  await expect(spacing).toBeInViewport();
  await expect(spacing).toHaveAttribute('data-settings-highlight', '');
});

test('a deep link with an earlier page id opens the page that took it over', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, 'settings_link');

  await page.goto('/settings/devices');
  const dialog = dialogOf(page);
  await expect(menuButton(dialog, 'Privacy & security')).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\/home\/?$/);
  await expect(setting(dialog, 'hideActivity')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await page.goto('/settings/general');
  await expect(menuButton(dialog, 'Appearance')).toHaveAttribute('aria-pressed', 'true');
});

test('on a phone the menu comes first, a page covers it, and Back returns to it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'settings_phone');
  await openSettings(page);
  // The dialog takes the name of the first heading in it, which a page covers on a phone.
  const dialog = page.getByRole('dialog');
  await expect(menuButton(dialog, 'Chats')).toBeVisible();
  await expect(setting(dialog, 'systemTheme')).toHaveCount(0);

  await menuButton(dialog, 'Chats').click();
  await expect(setting(dialog, 'enterForNewline')).toBeVisible();
  await expect(dialog.getByRole('navigation', { name: 'Settings' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(menuButton(dialog, 'Chats')).toBeVisible();

  // A search result opens its page the same way, and Back finds the results again.
  await searchField(dialog).fill('24-hour');
  await dialog.getByRole('option').first().click();
  await expect(setting(dialog, 'hour24Clock')).toBeInViewport();
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(searchField(dialog)).toHaveValue('24-hour');
  await expect(dialog.getByRole('option').first()).toContainText('24-Hour Time Format');
});

test('screenshots of the regrouped Settings', async ({ page }) => {
  test.skip(!SHOTS, 'Set SETTINGS_SHOTS=<directory> to save the screenshots');
  test.slow();
  await signIn(page, 'settings_shots');

  const shoot = async (
    themeId: string,
    width: number,
    height: number,
    file: string,
    show: (dialog: Locator) => Promise<void>
  ) => {
    await page.setViewportSize({ width, height });
    await page.evaluate((id) => {
      const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
      localStorage.setItem(
        'settings',
        JSON.stringify({ ...settings, useSystemTheme: false, themeId: id })
      );
    }, themeId);
    await page.goto('/home/');
    await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
    const dialog = await openSettings(page);
    await show(dialog);
    // The sync pill can come back while the dialog opens; the picture waits for it to go.
    await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${SHOTS}/${file}` });
  };

  const privacy = async (dialog: Locator) => {
    await menuButton(dialog, 'Privacy & security').click();
    await expect(setting(dialog, 'blockedUsers')).toBeVisible();
  };
  await shoot('dark-theme', 1280, 800, 'L21-settings-dark.png', privacy);
  await shoot('light-theme', 1280, 800, 'L21-settings-light.png', async (dialog) => {
    await expect(setting(dialog, 'systemTheme')).toBeVisible();
  });
  await shoot('dark-theme', 390, 844, 'L21-settings-phone.png', async (dialog) => {
    await expect(menuButton(dialog, 'Appearance')).toBeVisible();
  });
  await shoot('dark-theme', 1280, 800, 'L21-settings-search.png', async (dialog) => {
    await searchField(dialog).fill('dark mode');
    await expect(dialog.getByRole('option').first()).toBeVisible();
  });
});
