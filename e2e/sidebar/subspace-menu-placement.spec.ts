import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Locator } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { addRoomToSpace, setAccountData } from '../helpers/matrix';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// On a phone with top/bottom safe-area insets (Dynamic Island / status bar + home indicator), a
// tall sub-space options menu that falls back beside its trigger stays clear of both safe areas.
// Set SUBSPACE_MENU_SHOTS=<directory> to save a screenshot and layout metrics before assertions.
const PASSWORD = 'subspace-menu-placement-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.SUBSPACE_MENU_SHOTS;

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('keeps a phone sub-space options menu clear of the top and bottom safe areas', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const account = await registerDisposableUser(`smp_${RUN}`, PASSWORD);
  await setAccountData(HOMESERVER, account.accessToken, account.userId, 'io.mindroom.settings', {
    tourOffered: true,
  });
  const grove = await createRoom(HOMESERVER, account.accessToken, { name: 'Grove', space: true });
  const canopy = await createRoom(HOMESERVER, account.accessToken, { name: 'Canopy', space: true });
  await addRoomToSpace(HOMESERVER, account.accessToken, grove, canopy);
  const addRooms = async (spaceId: string, names: string[]) => {
    for (const name of names) {
      const roomId = await createRoom(HOMESERVER, account.accessToken, { name });
      await addRoomToSpace(HOMESERVER, account.accessToken, spaceId, roomId);
    }
  };
  await addRooms(grove, ['Alder', 'Birch', 'Cedar', 'Dahlia', 'Elm', 'Fern', 'Gorse', 'Hazel']);
  await addRooms(canopy, ['Juniper', 'Larch']);

  const context = await browser.newContext({
    viewport: { width: 440, height: 956 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34 } });

    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: account.username,
      password: PASSWORD,
    });
    const menuButton = page.locator('#phone-nav-menu-button');
    await expect(menuButton).toBeVisible({ timeout: 30_000 });
    const drawer = page.locator('#phone-nav-drawer');
    if ((await menuButton.getAttribute('aria-expanded')) !== 'true') await menuButton.tap();
    await expect(drawer).toBeVisible();
    await expect.poll(() => drawer.evaluate((panel) => panel.getAnimations().length)).toBe(0);

    const groveButton = drawer.locator(`button[data-id="${grove}"]`);
    await expect(groveButton).toBeVisible({ timeout: 30_000 });
    await groveButton.tap();
    const groveRows = page
      .getByRole('navigation', { name: 'Grove', exact: true })
      .locator('[data-room-id]');
    await expect.poll(() => groveRows.count(), { timeout: 30_000 }).toBe(10);

    const canopyOptions = drawer.getByRole('button', { name: 'Canopy options' });
    await expect(canopyOptions).toBeVisible();
    await canopyOptions.tap();

    const menu = page.getByRole('menu');
    const leaveSpace = page.getByRole('menuitem', { name: 'Leave Space' });
    await expect(menu).toBeVisible();
    await expect(leaveSpace).toBeVisible();

    const rectOf = (locator: Locator) =>
      locator.evaluate((el) => {
        const { top, bottom, left, right, height } = el.getBoundingClientRect();
        return { top, bottom, left, right, height };
      });
    const [menuBox, sortHeadingBox, leaveSpaceBox] = await Promise.all([
      rectOf(menu),
      rectOf(menu.getByText(/^sort rooms$/i)),
      rectOf(leaveSpace),
    ]);

    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/subspace-menu-phone.png` });
      const metrics = {
        ...menuBox,
        sortHeadingTop: sortHeadingBox.top,
        leaveSpaceBottom: leaveSpaceBox.bottom,
      };
      writeFileSync(
        `${SHOTS}/subspace-menu-phone-metrics.json`,
        `${JSON.stringify(metrics, null, 2)}\n`
      );
    }

    expect(menuBox.top).toBeGreaterThanOrEqual(59 + 7);
    expect(menuBox.bottom).toBeLessThanOrEqual(956 - 34 - 7);
    expect(menuBox.left).toBeGreaterThanOrEqual(7);
    expect(menuBox.right).toBeLessThanOrEqual(440 - 7);
    for (const box of [sortHeadingBox, leaveSpaceBox]) {
      expect(box.top).toBeGreaterThanOrEqual(Math.max(menuBox.top, 59 + 7));
      expect(box.bottom).toBeLessThanOrEqual(menuBox.bottom);
    }
  } finally {
    await context.close();
  }
});
