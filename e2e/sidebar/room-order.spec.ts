import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  matrixFetch,
  sendRoomMessage,
  sendStateEvent,
  setAccountData,
  type MatrixSession,
} from '../helpers/matrix';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Rooms move up and down in their section by drag and drop or from the keyboard, against the
// disposable homeserver of `just hs-up` (or a slot of scripts/e2e-slot.sh). The order is saved in
// the `io.mindroom.room_order` account data, so it holds after a reload and shows on a second
// session. Set ROOM_ORDER_SHOTS=<directory> to also save the L19 screenshots during and after a
// drag.
const PASSWORD = 'room-order-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.ROOM_ORDER_SHOTS;

type Account = MatrixSession & { username: string };

const registerAndLogin = (name: string): Promise<Account> =>
  registerDisposableUser(`l19_${name}_${RUN}`, PASSWORD);

const signIn = (page: Page, account: Account) =>
  loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: account.username,
    password: PASSWORD,
  });

/** The room rows of a page navigation (Home, or a space by its name), top to bottom. */
const rows = (page: Page, nav: string) =>
  page.getByRole('navigation', { name: nav, exact: true }).locator('[data-room-id]');

const rowOrder = (page: Page, nav: string) =>
  rows(page, nav).evaluateAll((found) => found.map((row) => row.getAttribute('data-room-id')));

const row = (page: Page, nav: string, roomId: string) =>
  rows(page, nav).and(page.locator(`[data-room-id="${roomId}"]`));

type SavedRoomOrder = {
  lists?: Record<string, unknown>;
  modes?: Record<string, unknown>;
  showTimes?: Record<string, unknown>;
};

/** The stored `io.mindroom.room_order` account data, straight from the homeserver. */
const savedRoomOrder = async (account: Account): Promise<SavedRoomOrder | undefined> => {
  try {
    return await matrixFetch<SavedRoomOrder>(
      HOMESERVER,
      `/user/${encodeURIComponent(account.userId)}/account_data/io.mindroom.room_order`,
      { accessToken: account.accessToken }
    );
  } catch {
    return undefined;
  }
};

/** The saved lists of `io.mindroom.room_order`, straight from the homeserver. */
const savedLists = async (account: Account): Promise<Record<string, unknown> | undefined> =>
  (await savedRoomOrder(account))?.lists;

/** The saved `sidebar` of `io.mindroom.spaces`, straight from the homeserver. */
const savedSidebar = async (account: Account): Promise<unknown[] | undefined> => {
  try {
    const content = await matrixFetch<{ sidebar?: unknown[] }>(
      HOMESERVER,
      `/user/${encodeURIComponent(account.userId)}/account_data/io.mindroom.spaces`,
      { accessToken: account.accessToken }
    );
    return content.sidebar;
  } catch {
    return undefined;
  }
};

/**
 * Drags `from` with the mouse onto the upper edge of `to`, near enough to its middle that `to`
 * is the row it lands on. `whileOver` runs before the drop, with the pointer still held there.
 */
const dragOnto = async (
  page: Page,
  from: Locator,
  to: Locator,
  whileOver?: () => Promise<void>
) => {
  const start = (await from.boundingBox())!;
  const target = (await to.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 - 12, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height * 0.1, { steps: 12 });
  await whileOver?.();
  await page.mouse.up();
  // Wait past @dnd-kit's 50 ms post-drag click guard (DRAG_LIBRARY_CLICK_GUARD_MS).
  await page.waitForTimeout(80);
};

/** The rail, the page navigation and the top of the content, for the L19 screenshots. */
const shot = async (page: Page, nav: string, name: string) => {
  if (!SHOTS) return;
  const box = (await page.getByRole('navigation', { name: nav, exact: true }).boundingBox())!;
  await page.screenshot({
    path: `${SHOTS}/L19-room-drag-${name}.png`,
    clip: { x: 0, y: 0, width: box.x + box.width + 24, height: 360 },
  });
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a room dragged above another keeps its place after a reload and on a second session', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const account = await registerAndLogin('home');
  const alder = await createRoom(HOMESERVER, account.accessToken, { name: 'Alder' });
  const birch = await createRoom(HOMESERVER, account.accessToken, { name: 'Birch' });
  const cedar = await createRoom(HOMESERVER, account.accessToken, { name: 'Cedar' });

  await signIn(page, account);
  await expect
    .poll(() => rowOrder(page, 'Home'), { timeout: 30_000 })
    .toEqual([alder, birch, cedar]);

  // Dragging Cedar onto Alder: a line marks the landing place above Alder, and Cedar takes it.
  await dragOnto(page, row(page, 'Home', cedar), row(page, 'Home', alder), async () => {
    await expect(row(page, 'Home', alder).locator('xpath=..')).toHaveAttribute(
      'data-drop-at',
      'above'
    );
    await shot(page, 'Home', 'during');
  });
  await expect.poll(() => rowOrder(page, 'Home')).toEqual([cedar, alder, birch]);
  // The drop did not open the dragged room.
  await expect(page).not.toHaveURL(new RegExp(encodeURIComponent(cedar)));
  await expect.poll(() => savedLists(account)).toEqual({ home: [cedar, alder, birch] });
  await page.mouse.move(600, 500);
  await shot(page, 'Home', 'after');

  await page.reload();
  await expect
    .poll(() => rowOrder(page, 'Home'), { timeout: 30_000 })
    .toEqual([cedar, alder, birch]);

  // A second session reads the order from the account, and follows a change made in the first.
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await signIn(other, account);
    await expect
      .poll(() => rowOrder(other, 'Home'), { timeout: 30_000 })
      .toEqual([cedar, alder, birch]);

    // Ctrl (Command on a Mac) with Shift and the down arrow on a room's link moves it one place
    // down.
    await row(page, 'Home', alder).getByRole('link').focus();
    await page.keyboard.press('ControlOrMeta+Shift+ArrowDown');
    await expect.poll(() => rowOrder(page, 'Home')).toEqual([cedar, birch, alder]);
    await expect
      .poll(() => rowOrder(other, 'Home'), { timeout: 30_000 })
      .toEqual([cedar, birch, alder]);
  } finally {
    await otherContext.close();
  }

  // Each press with the up arrow moves the room one more place up; the focus stays on its link.
  const alderLink = row(page, 'Home', alder).getByRole('link');
  await alderLink.focus();
  await page.keyboard.press('ControlOrMeta+Shift+ArrowUp');
  await expect.poll(() => rowOrder(page, 'Home')).toEqual([cedar, alder, birch]);
  await expect(alderLink).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Shift+ArrowUp');
  await expect.poll(() => rowOrder(page, 'Home')).toEqual([alder, cedar, birch]);
  await expect.poll(() => savedLists(account)).toEqual({ home: [alder, cedar, birch] });

  // Home's Sort rooms menu switches back to A to Z while preserving the saved Custom order.
  await page.getByRole('button', { name: 'Sort rooms' }).click();
  await page.getByRole('menuitemradio', { name: 'A to Z' }).click();
  await expect.poll(() => rowOrder(page, 'Home')).toEqual([alder, birch, cedar]);
  await expect
    .poll(() => savedRoomOrder(account))
    .toEqual({
      lists: { home: [alder, cedar, birch] },
      modes: { home: 'name' },
    });

  // Switching back to Custom order restores the preserved custom list.
  await page.getByRole('button', { name: 'Sort rooms' }).click();
  await expect(page.getByRole('menuitemradio', { name: /Custom order/ })).toContainText('Saved');
  await page.getByRole('menuitemradio', { name: /Custom order/ }).click();
  await expect.poll(() => rowOrder(page, 'Home')).toEqual([alder, cedar, birch]);
});

test('a room dragged slowly moves without opening it or reloading the page', async ({ page }) => {
  test.setTimeout(120_000);
  const account = await registerAndLogin('slow');
  const alder = await createRoom(HOMESERVER, account.accessToken, { name: 'Alder' });
  const birch = await createRoom(HOMESERVER, account.accessToken, { name: 'Birch' });
  const cedar = await createRoom(HOMESERVER, account.accessToken, { name: 'Cedar' });

  await signIn(page, account);
  await expect
    .poll(() => rowOrder(page, 'Home'), { timeout: 30_000 })
    .toEqual([alder, birch, cedar]);
  // A mark on this document, which a reload would drop.
  await page.evaluate(() => {
    document.body.dataset.beforeDrag = 'yes';
  });

  // A person's drag of Cedar onto Alder: two seconds from the press to the drop.
  const start = (await row(page, 'Home', cedar).boundingBox())!;
  const target = (await row(page, 'Home', alder).boundingBox())!;
  const x = start.x + start.width / 2;
  const fromY = start.y + start.height / 2;
  const toY = target.y + target.height * 0.1;
  await page.mouse.move(x, fromY);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) {
    await page.mouse.move(x, fromY + ((toY - fromY) * step) / 20);
    await page.waitForTimeout(100);
  }
  await page.mouse.up();

  await expect.poll(() => rowOrder(page, 'Home')).toEqual([cedar, alder, birch]);
  await expect.poll(() => savedLists(account)).toEqual({ home: [cedar, alder, birch] });
  await expect(page.locator('body')).toHaveAttribute('data-before-drag', 'yes');
  await expect(page).not.toHaveURL(new RegExp(encodeURIComponent(cedar)));
});

test("a space's rooms and the rail's spaces move by drag and drop", async ({ page }) => {
  test.setTimeout(240_000);
  const account = await registerAndLogin('space');
  const grove = await createRoom(HOMESERVER, account.accessToken, { name: 'Grove', space: true });
  const meadow = await createRoom(HOMESERVER, account.accessToken, { name: 'Meadow', space: true });
  const roomIds: string[] = [];
  for (const name of ['Dahlia', 'Elm', 'Fern']) {
    const roomId = await createRoom(HOMESERVER, account.accessToken, { name });
    await addRoomToSpace(HOMESERVER, account.accessToken, grove, roomId);
    roomIds.push(roomId);
  }
  const [dahlia, elm, fern] = roomIds as [string, string, string];

  await signIn(page, account);
  const rail = page.getByRole('group', { name: 'Spaces' });
  const railButton = (spaceId: string) => rail.locator(`button[data-id="${spaceId}"]`);
  const railOrder = () =>
    rail
      .locator('[data-id]')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-id')));
  await expect
    .poll(async () => [...(await railOrder())].sort(), { timeout: 30_000 })
    .toEqual([grove, meadow].sort());

  // The space's Rooms section: Fern dragged onto Dahlia takes its place.
  await railButton(grove).click();
  await expect
    .poll(() => rowOrder(page, 'Grove'), { timeout: 30_000 })
    .toEqual([dahlia, elm, fern]);
  await dragOnto(page, row(page, 'Grove', fern), row(page, 'Grove', dahlia));
  await expect.poll(() => rowOrder(page, 'Grove')).toEqual([fern, dahlia, elm]);
  await expect.poll(() => savedLists(account)).toEqual({ [grove]: [fern, dahlia, elm] });

  // Ctrl (Command on a Mac) with Shift and the up arrow moves a room one place up.
  await row(page, 'Grove', elm).getByRole('link').focus();
  await page.keyboard.press('ControlOrMeta+Shift+ArrowUp');
  await expect.poll(() => rowOrder(page, 'Grove')).toEqual([fern, elm, dahlia]);
  await expect.poll(() => savedLists(account)).toEqual({ [grove]: [fern, elm, dahlia] });

  // The rail: the lower space dragged onto the upper edge of the other goes above it. Nothing is
  // clicked right after this drop: the drag library stops every click until 50 ms after the
  // release, which no page state shows and no person is fast enough to meet.
  const [upper, lower] = (await railOrder()) as [string, string];
  const upperBox = (await railButton(upper).boundingBox())!;
  const lowerBox = (await railButton(lower).boundingBox())!;
  await page.mouse.move(lowerBox.x + lowerBox.width / 2, lowerBox.y + lowerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(lowerBox.x + lowerBox.width / 2, lowerBox.y + 4, { steps: 4 });
  await page.mouse.move(upperBox.x + upperBox.width / 2, upperBox.y + upperBox.height * 0.15, {
    steps: 12,
  });
  await page.mouse.up();
  await expect.poll(railOrder).toEqual([lower, upper]);
  await expect.poll(() => savedSidebar(account)).toEqual([lower, upper]);

  // Both orders hold after a reload, loaded from the account's saved data.
  await page.reload();
  await expect
    .poll(() => rowOrder(page, 'Grove'), { timeout: 30_000 })
    .toEqual([fern, elm, dahlia]);
  await expect.poll(railOrder).toEqual([lower, upper]);
});

test('sorts by recent activity with activity times, preserves custom order, and overrides sub-spaces', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const account = await registerAndLogin('sort');
  const grove = await createRoom(HOMESERVER, account.accessToken, { name: 'Grove', space: true });
  const canopy = await createRoom(HOMESERVER, account.accessToken, { name: 'Canopy', space: true });
  await addRoomToSpace(HOMESERVER, account.accessToken, grove, canopy);

  const alder = await createRoom(HOMESERVER, account.accessToken, { name: 'Alder' });
  const birch = await createRoom(HOMESERVER, account.accessToken, { name: 'Birch' });
  const cedar = await createRoom(HOMESERVER, account.accessToken, { name: 'Cedar' });
  const dahlia = await createRoom(HOMESERVER, account.accessToken, { name: 'Dahlia' });
  await addRoomToSpace(HOMESERVER, account.accessToken, grove, alder);
  await addRoomToSpace(HOMESERVER, account.accessToken, grove, birch);
  await addRoomToSpace(HOMESERVER, account.accessToken, canopy, cedar);
  await addRoomToSpace(HOMESERVER, account.accessToken, canopy, dahlia);

  await signIn(page, account);
  const rail = page.getByRole('group', { name: 'Spaces' });
  await rail.locator(`button[data-id="${grove}"]`).click();
  await expect
    .poll(() => rowOrder(page, 'Grove'), { timeout: 30_000 })
    .toEqual([alder, birch, cedar, dahlia]);

  // Drag Birch above Alder to create a saved Custom order for Grove.
  await dragOnto(page, row(page, 'Grove', birch), row(page, 'Grove', alder));
  await expect.poll(() => rowOrder(page, 'Grove')).toEqual([birch, alder, cedar, dahlia]);
  await expect.poll(() => savedLists(account)).toEqual({ [grove]: [birch, alder] });

  // Open Grove's Sort rooms menu: enable Show activity times, then switch to Recent activity.
  const groveNav = page.getByRole('navigation', { name: 'Grove', exact: true });
  await groveNav.getByRole('button', { name: 'Sort rooms' }).click();
  const showTimesToggle = page.getByRole('menuitemcheckbox', { name: 'Show activity times' });
  await showTimesToggle.click();
  await expect(showTimesToggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: 'Recent activity' }).click();

  // Send live messages: Birch first, then Alder so Alder moves to the top; Dahlia moves above Cedar.
  await sendRoomMessage(HOMESERVER, account.accessToken, birch, {
    msgtype: 'm.text',
    body: 'earlier in birch',
  });
  await sendRoomMessage(HOMESERVER, account.accessToken, cedar, {
    msgtype: 'm.text',
    body: 'earlier in cedar',
  });
  // Brief gap so sequential local homeserver sends get distinct millisecond origin_server_ts.
  await page.waitForTimeout(50);
  await sendRoomMessage(HOMESERVER, account.accessToken, alder, {
    msgtype: 'm.text',
    body: 'latest in alder',
  });
  await page.waitForTimeout(50);
  // Newer state events in Birch must not bump Birch above Alder in Recent activity mode.
  await sendStateEvent(HOMESERVER, account.accessToken, birch, 'm.room.topic', '', {
    topic: 'birch topic',
  });
  await sendStateEvent(HOMESERVER, account.accessToken, birch, 'com.example.room_features', '', {
    capabilities: ['threads'],
  });
  await sendRoomMessage(HOMESERVER, account.accessToken, dahlia, {
    msgtype: 'm.text',
    body: 'latest in dahlia',
  });

  await expect
    .poll(() => rowOrder(page, 'Grove'), { timeout: 30_000 })
    .toEqual([alder, birch, dahlia, cedar]);
  // Move cursor away from rows so row hover options do not hide the quiet-row timestamp.
  await page.mouse.move(0, 0);
  await expect(row(page, 'Grove', alder).locator('[data-room-activity-time]')).toBeVisible();

  // Override Canopy sub-space to A to Z independently of Grove.
  await groveNav.getByRole('button', { name: 'Canopy', exact: true }).hover();
  await groveNav.getByRole('button', { name: 'Canopy options' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Match space (Recent)' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await page.getByRole('menuitemradio', { name: 'A to Z' }).click();
  await expect.poll(() => rowOrder(page, 'Grove')).toEqual([alder, birch, cedar, dahlia]);

  // Reset Canopy back to Match space (Recent).
  await groveNav.getByRole('button', { name: 'Canopy', exact: true }).hover();
  await groveNav.getByRole('button', { name: 'Canopy options' }).click();
  await page.getByRole('menuitemradio', { name: 'Match space (Recent)' }).click();
  await expect.poll(() => rowOrder(page, 'Grove')).toEqual([alder, birch, dahlia, cedar]);

  // Switching Grove back to Custom order restores Grove's [birch, alder] and freezes Canopy's [dahlia, cedar].
  await groveNav.getByRole('button', { name: 'Sort rooms' }).click();
  await expect(page.getByRole('menuitemradio', { name: /Custom order/ })).toContainText('Saved');
  await page.getByRole('menuitemradio', { name: /Custom order/ }).click();
  await expect.poll(() => rowOrder(page, 'Grove')).toEqual([birch, alder, dahlia, cedar]);
  await expect
    .poll(() => savedRoomOrder(account))
    .toEqual({
      lists: { [grove]: [birch, alder], [canopy]: [dahlia, cedar] },
      modes: { [grove]: 'manual', [canopy]: 'inherit' },
      showTimes: { [grove]: true },
    });

  // Reload preserves the mode and activity times.
  await page.reload();
  await expect
    .poll(() => rowOrder(page, 'Grove'), { timeout: 30_000 })
    .toEqual([birch, alder, dahlia, cedar]);
  await page.mouse.move(0, 0);
  await expect(row(page, 'Grove', birch).locator('[data-room-activity-time]')).toBeVisible();
});

test('keeps a phone sub-space options menu clear of the top and bottom safe areas', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const account = await registerAndLogin('phone_subspace');
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

    await signIn(page, account);
    const menuButton = page.locator('#phone-nav-menu-button');
    await expect(menuButton).toBeVisible({ timeout: 30_000 });
    const drawer = page.locator('#phone-nav-drawer');
    if ((await menuButton.getAttribute('aria-expanded')) !== 'true') await menuButton.tap();
    await expect(drawer).toBeVisible();
    await expect.poll(() => drawer.evaluate((panel) => panel.getAnimations().length)).toBe(0);

    const groveButton = drawer.locator(`button[data-id="${grove}"]`);
    await expect(groveButton).toBeVisible({ timeout: 30_000 });
    await groveButton.tap();
    await expect.poll(() => rows(page, 'Grove').count(), { timeout: 30_000 }).toBe(10);

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
