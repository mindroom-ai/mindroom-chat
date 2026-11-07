import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { addRoomToSpace, loginToMatrix, matrixFetch, type MatrixSession } from '../helpers/matrix';
import { createRoom } from '../helpers/createRoom';

// Rooms move up and down in their section by drag and drop or from the keyboard, against the
// disposable homeserver of `just hs-up` (or a slot of scripts/e2e-slot.sh). The order is saved in
// the `io.mindroom.room_order` account data, so it holds after a reload and shows on a second
// session. Set ROOM_ORDER_SHOTS=<directory> to also save the L19 screenshots during and after a
// drag.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'room-order-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.ROOM_ORDER_SHOTS;

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

type Account = MatrixSession & { username: string };

const registerAndLogin = async (name: string): Promise<Account> => {
  const username = `l19_${name}_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

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

/** The saved lists of `io.mindroom.room_order`, straight from the homeserver. */
const savedLists = async (account: Account): Promise<Record<string, unknown> | undefined> => {
  try {
    const content = await matrixFetch<{ lists?: Record<string, unknown> }>(
      HOMESERVER,
      `/user/${encodeURIComponent(account.userId)}/account_data/io.mindroom.room_order`,
      { accessToken: account.accessToken }
    );
    return content.lists;
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
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
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

  // Home's menu puts the rooms back in A to Z order and forgets the saved order.
  await page.getByRole('button', { name: 'Home Options' }).click();
  await page.getByRole('menuitem', { name: 'Sort Rooms A to Z' }).click();
  await expect.poll(() => rowOrder(page, 'Home')).toEqual([alder, birch, cedar]);
  await expect.poll(() => savedLists(account)).toEqual({});
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

  // The rail: the lower space dragged onto the upper edge of the other goes above it.
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

  await page.reload();
  await expect
    .poll(() => rowOrder(page, 'Grove'), { timeout: 30_000 })
    .toEqual([fern, elm, dahlia]);
});
