import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { activeAccountButton, loginWithPassword } from '../helpers/auth';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { setAccountData } from '../helpers/matrix';

// Right-clicking any configurable icon rail button or empty space on the rail opens the shared
// Show in sidebar context menu; toggling off the right-clicked button keeps the menu open,
// Direct Messages keeps Mark as Read above the toggles, and Sidebar settings… opens Settings
// directly on the Sidebar page. Set RAIL_VISIBILITY_MENU_SHOTS=<dir> to capture screenshots.

const PASSWORD = 'rail-visibility-menu-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.RAIL_VISIBILITY_MENU_SHOTS;

test.use({
  viewport: { width: 1280, height: 800 },
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main', exact: true });

const saveShot = async (page: Page, name: string, fullViewport = false) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  if (fullViewport) {
    await page.screenshot({ path: path.join(SHOTS, name) });
    return;
  }
  const railBox = (await rail(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  await page.screenshot({
    path: path.join(SHOTS, name),
    clip: {
      x: 0,
      y: 0,
      width: Math.min(viewport.width, Math.ceil(railBox.x + railBox.width + 260)),
      height: viewport.height,
    },
  });
};

const emptyRailPoint = (page: Page) =>
  rail(page).evaluate((nav) => {
    const rect = nav.getBoundingClientRect();
    const boxes = Array.from(nav.querySelectorAll('button'))
      .map((btn) => btn.getBoundingClientRect())
      .sort((a, b) => a.top - b.top);
    let bestGap = 0;
    let bestY = rect.top + rect.height / 2;
    for (let i = 1; i < boxes.length; i += 1) {
      const gap = boxes[i]!.top - boxes[i - 1]!.bottom;
      if (gap > bestGap) {
        bestGap = gap;
        bestY = boxes[i - 1]!.bottom + gap / 2;
      }
    }
    return { x: rect.left + rect.width / 2, y: bestY };
  });

test('customizes rail buttons from right-click menus on buttons and empty rail space', async ({
  page,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(60_000);

  const user = await registerDisposableUser(`rail_menu_${RUN}`, PASSWORD);
  await setAccountData(HOMESERVER, user.accessToken, user.userId, 'io.mindroom.settings', {
    tourOffered: true,
    showThreadsInSidebar: true,
    showExploreInSidebar: true,
    showCreateSpaceInSidebar: true,
    showSearchInSidebar: true,
    showHelpInSidebar: true,
  });

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: user.username,
    password: PASSWORD,
  });
  await expect(activeAccountButton(page)).toBeVisible({ timeout: 120_000 });

  const threadsButton = rail(page).getByRole('button', { name: 'Threads', exact: true });
  const directButton = rail(page).getByRole('button', { name: 'Direct Messages', exact: true });
  await expect(threadsButton).toBeVisible();
  await expect(directButton).toBeVisible();

  // 1. Right-click Threads: Show in sidebar switches and Sidebar settings… open, without Mark as Read.
  await threadsButton.click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('group', { name: 'Show in sidebar' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Mark as Read', exact: true })).toHaveCount(0);
  await expect(
    menu.getByRole('menuitem', { name: 'Sidebar settings…', exact: true })
  ).toBeVisible();
  const threadsToggle = menu.getByRole('menuitemcheckbox', { name: 'Threads', exact: true });
  await expect(threadsToggle).toHaveAttribute('aria-checked', 'true');
  await saveShot(page, 'threads-menu.png');

  // 2. Toggle Threads OFF in place: the rail icon disappears while the menu stays open.
  await threadsToggle.click();
  await expect(threadsToggle).toHaveAttribute('aria-checked', 'false');
  await expect(threadsButton).toHaveCount(0);
  await expect(menu).toBeVisible();
  await saveShot(page, 'after-toggle-off.png');

  // 3. Right-click Direct Messages: Mark as Read appears above Show in sidebar and Sidebar settings….
  await directButton.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Mark as Read', exact: true })).toBeVisible();
  await expect(menu.getByRole('group', { name: 'Show in sidebar' })).toBeVisible();
  await expect(
    menu.getByRole('menuitem', { name: 'Sidebar settings…', exact: true })
  ).toBeVisible();
  await saveShot(page, 'direct-menu.png');

  // 4. Click Sidebar settings…: opens Settings directly on the Sidebar page with Threads off.
  await menu.getByRole('menuitem', { name: 'Sidebar settings…', exact: true }).click();
  await expect(menu).toHaveCount(0);
  const settingsSwitch = page.getByRole('switch', { name: 'Show Threads in the sidebar' });
  await expect(settingsSwitch).toBeVisible();
  await expect(settingsSwitch).toHaveAttribute('aria-checked', 'false');
  await saveShot(page, 'sidebar-settings.png', true);

  // 5. Close Settings, right-click empty rail space, and toggle Threads back ON.
  await page.keyboard.press('Escape');
  await expect(settingsSwitch).toHaveCount(0);
  const emptyPoint = await emptyRailPoint(page);
  await page.mouse.click(emptyPoint.x, emptyPoint.y, { button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Mark as Read', exact: true })).toHaveCount(0);
  const restoreThreads = menu.getByRole('menuitemcheckbox', { name: 'Threads', exact: true });
  await expect(restoreThreads).toHaveAttribute('aria-checked', 'false');
  await restoreThreads.click();
  await expect(restoreThreads).toHaveAttribute('aria-checked', 'true');
  await expect(threadsButton).toBeVisible();
  await expect(menu).toBeVisible();
});
