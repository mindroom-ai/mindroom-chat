import { expect, test, type Locator, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { createPrivateRoom } from '../helpers/matrix';
import { roomMoreOptions } from '../helpers/roomMenu';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// A menu with more rows than fit (a settings picker's dark themes in a short window, a phone's
// room menu) scrolls its rows inside the menu. The menu holds still: it draws the glass rim, and
// a menu that scrolled itself carried the rim up with the rows, so a frame cut across the list.
const PASSWORD = 'menu-scroll-spec-password';
const RUN = Date.now().toString(36);

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** Reveals the menu's last row with `reveal`, then checks the rows moved and the menu did not. */
const expectRowsScrollInside = async (menu: Locator, reveal: (last: Locator) => Promise<void>) => {
  const last = menu.getByRole('menuitemradio').or(menu.getByRole('menuitem')).last();
  await expect(menu).toBeVisible();
  // The rim is the menu's own ::before, so it moves only if the menu scrolls.
  expect(await menu.evaluate((element) => getComputedStyle(element, '::before').position)).toBe(
    'absolute'
  );
  await expect(last).not.toBeInViewport();

  await reveal(last);
  await expect(last).toBeInViewport();
  expect(await menu.evaluate((element) => element.scrollTop)).toBe(0);
  expect(
    await menu.evaluate((element) => element.scrollHeight - element.clientHeight)
  ).toBeLessThanOrEqual(1);
};

/** How far `row` sits from the start and the end edge of its menu, in pixels. */
const edgeGaps = (row: Locator) =>
  row.evaluate((element) => {
    const rowBox = element.getBoundingClientRect();
    const menuBox = element.closest('[role="menu"]')?.getBoundingClientRect() ?? rowBox;
    return { start: rowBox.left - menuBox.left, end: menuBox.right - rowBox.right };
  });

/** Signs a new account in and opens Settings at Appearance. */
const openAppearance = async (page: Page, name: string) => {
  const user = await registerDisposableUser(`${name}_${RUN}`, PASSWORD);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  await chooseFromAccountMenu(page, 'Settings');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('button', { name: 'Appearance', exact: true })
    .click();
  return dialog;
};

test('a long settings picker scrolls its rows inside a menu that stays put', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const dialog = await openAppearance(page, 'choice_menu');
  await dialog.locator('[data-setting-id="darkTheme"]').getByRole('button').click();

  const menu = page.getByRole('menu');
  await expectRowsScrollInside(menu, async () => {
    await menu.hover();
    await page.mouse.wheel(0, 2000);
  });

  // Home and End reach both ends of the list the same way.
  const rows = menu.getByRole('menuitemradio');
  await page.keyboard.press('Home');
  await expect(rows.first()).toBeFocused();
  await expect(rows.last()).not.toBeInViewport();
  await page.keyboard.press('End');
  await expect(rows.last()).toBeFocused();
  await expect(rows.last()).toBeInViewport();
  expect(await menu.evaluate((element) => element.scrollTop)).toBe(0);
});

test('a settings picker that fits keeps its rows as far from both edges of the menu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const dialog = await openAppearance(page, 'choice_fit');
  await dialog.locator('[data-setting-id="lightTheme"]').getByRole('button').click();

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  expect(
    await menu.evaluate((element) => element.scrollHeight - element.clientHeight)
  ).toBeLessThanOrEqual(1);
  const { start, end } = await edgeGaps(menu.getByRole('menuitemradio').first());
  expect(Math.abs(end - start)).toBeLessThanOrEqual(1);
});

test('a phone room menu taller than the screen scrolls its rows inside the menu', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 420 },
    hasTouch: true,
    isMobile: true,
    baseURL,
  });
  try {
    const page = await context.newPage();
    const user = await registerDisposableUser(`room_menu_${RUN}`, PASSWORD);
    const roomId = await createPrivateRoom(HOMESERVER, user.accessToken, { name: 'Long menu' });
    await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
    await page.goto(`/home/${encodeURIComponent(roomId)}/`);
    await expect(roomMoreOptions(page)).toBeVisible({ timeout: 60_000 });
    await roomMoreOptions(page).tap();

    await expectRowsScrollInside(page.getByRole('menu'), (last) => last.scrollIntoViewIfNeeded());
  } finally {
    await context.close();
  }
});
