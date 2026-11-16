import { expect, test, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { createPrivateRoom } from '../helpers/matrix';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';

// The command palette changes things: a theme picked on its Theme page, a switch setting flipped
// in place, another setting opened in Settings, and a command of the open room's header. Each
// test signs in a new account, so a setting one of them changes reaches no other.
const PASSWORD = 'command-palette-commands-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.use({ viewport: { width: 1280, height: 800 } });

const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette', exact: true });
const row = (page: Page, id: string) =>
  palette(page).locator(`[role="option"][data-item-id="${id}"]`);

const register = (name: string) => registerDisposableUser(`cpc_${name}_${RUN}`, PASSWORD);

const signIn = async (page: Page, user: DisposableUser) => {
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
};

/** Types `text` into the palette's field and waits until the row `id` is the highlighted one. */
const findRow = async (page: Page, text: string, id: string) => {
  await palette(page).getByRole('combobox').fill(text);
  await expect(row(page, id)).toBeVisible();
  await expect(row(page, id)).toHaveAttribute('aria-selected', 'true');
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

test('a theme from the Theme page', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, await register('theme'));
  await pressPaletteShortcut(page);
  await findRow(page, 'theme', 'page-theme');
  await page.keyboard.press('Enter');
  await expect(palette(page).locator('[data-page-chip]')).toHaveText('Theme');
  await expect(palette(page).getByRole('tab')).toHaveCount(0);

  await findRow(page, 'dracula', 'theme:dracula-theme');
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveClass(/(^|\s)dracula-theme(\s|$)/);
  await expect(palette(page)).toBeVisible();
  await expect(row(page, 'theme:dracula-theme').locator('[data-row-current]')).toBeVisible();

  // Escape goes back to the first list, a second one closes the palette.
  await page.keyboard.press('Escape');
  await expect(palette(page).locator('[data-page-chip]')).toHaveCount(0);
  await expect(palette(page).getByRole('tab', { name: 'All', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('body')).toHaveClass(/(^|\s)dracula-theme(\s|$)/);
});

test('the highlighted theme shows for a look and goes with the page', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, await register('look'));
  const bodyClass = (themeId: string) => new RegExp(`(^|\\s)${themeId}(\\s|$)`);
  const highlighted = async () => {
    const id = await palette(page)
      .locator('[role="option"][aria-selected="true"]')
      .getAttribute('data-item-id');
    return (id ?? '').replace(/^theme:/, '');
  };
  await pressPaletteShortcut(page);
  await findRow(page, 'theme', 'page-theme');
  await page.keyboard.press('Enter');
  await expect(palette(page).locator('[data-page-chip]')).toHaveText('Theme');

  // The page opens on the theme in effect.
  const chosen = await highlighted();
  await expect(page.locator('body')).toHaveClass(bodyClass(chosen));
  await page.keyboard.press('ArrowDown');
  const looked = await highlighted();
  expect(looked).not.toBe(chosen);
  await expect(page.locator('body')).toHaveClass(bodyClass(looked));
  // The check mark stays on the chosen theme.
  await expect(row(page, `theme:${chosen}`).locator('[data-row-current]')).toBeVisible();
  await expect(row(page, `theme:${looked}`).locator('[data-row-current]')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(palette(page).locator('[data-page-chip]')).toHaveCount(0);
  await expect(page.locator('body')).toHaveClass(bodyClass(chosen));
});

test('a switch setting flips in place', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, await register('switch'));
  await pressPaletteShortcut(page);
  await findRow(page, 'markdown formatting', 'setting:markdown');
  await expect(row(page, 'setting:markdown').locator('[data-row-state="on"]')).toHaveText('On');
  await page.keyboard.press('Enter');
  await expect(row(page, 'setting:markdown').locator('[data-row-state="off"]')).toHaveText('Off');
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);

  await chooseFromAccountMenu(page, 'Settings');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('button', { name: 'Chats', exact: true })
    .click();
  await expect(settings.getByRole('switch', { name: 'Markdown Formatting' })).not.toBeChecked();
});

test('another setting opens Settings at it', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, await register('jump'));
  await pressPaletteShortcut(page);
  await findRow(page, 'page zoom', 'setting:pageZoom');
  await page.keyboard.press('Enter');
  await expect(palette(page)).toHaveCount(0);
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(
    settings
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: 'Appearance', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  const setting = settings.locator('[data-setting-id="pageZoom"]');
  await expect(setting).toHaveAttribute('data-settings-highlight', '');
  await expect
    .poll(() => setting.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
});

test('a room command', async ({ page }) => {
  test.setTimeout(120_000);
  const user = await register('room');
  // A room of people that is not a direct chat: its header has the Compact and Threads switch,
  // and it opens in Threads.
  const roomId = await createPrivateRoom(HOMESERVER, user.accessToken, {
    name: `Palette commands ${RUN}`,
  });
  await signIn(page, user);
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const viewSwitch = page.locator('[data-room-view-switch]');
  await expect(viewSwitch).toBeVisible({ timeout: 60_000 });
  await expect(viewSwitch).toHaveAttribute('aria-pressed', 'false');

  await pressPaletteShortcut(page);
  await findRow(page, 'compact view', 'room-command:viewSwitch');
  await page.keyboard.press('Enter');
  await expect(palette(page)).toHaveCount(0);
  await expect(viewSwitch).toHaveAttribute('aria-pressed', 'true');
});
