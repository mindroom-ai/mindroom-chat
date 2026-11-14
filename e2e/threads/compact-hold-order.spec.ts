import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { CHROMIUM_WITH_SCROLLBARS } from '../helpers/disposableAccounts';

// Compact cards sorted by last reply keep their order while the reader points at a card, has a
// card's menu open, or has keyboard focus on a card (Chromium): replies to threads further down do
// not move the card under the pointer; the new order applies once the reader lets go (THR-04).
// Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit; 1280x800,
// classic scrollbars shown.
const DESKTOP = { width: 1280, height: 800 };
const THREAD_COUNT = 30;
const TOPICS = [
  'Draft the onboarding email',
  'Profile the search API under load',
  'Deploy checklist for the release',
  'Translate the help center batch',
  'Rotate the staging keys',
];

test.use({
  viewport: DESKTOP,
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const threadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

type SeededRoom = { roomId: string; rootIds: string[]; agent: MatrixSession; userId: string };

/** 30 threads, oldest first: each a question of mine and the agent's answer. */
const seedRoom = async (homeserver: string, me: MatrixSession): Promise<SeededRoom> => {
  const roomId = await createPrivateRoom(homeserver, me.accessToken, {
    name: `Held order ${Date.now()}`,
    topic: 'Thirty threads sorted by last reply',
  });
  const agent = await registerAgentAccount(homeserver, 'helper');
  await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/invite`, {
    method: 'POST',
    accessToken: me.accessToken,
    body: JSON.stringify({ user_id: agent.userId }),
  });
  await joinRoom(homeserver, agent.accessToken, roomId);
  const rootIds: string[] = [];
  for (let index = 0; index < THREAD_COUNT; index += 1) {
    const title = `${TOPICS[index % TOPICS.length]} ${index}`;
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(homeserver, me.accessToken, roomId, {
      msgtype: 'm.text',
      body: title,
    });
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(homeserver, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Looking into ${title.toLowerCase()} now.`,
      'm.relates_to': threadRelation(rootId),
    });
    rootIds.push(rootId);
  }
  return { roomId, rootIds, agent, userId: me.userId };
};

const cardOf = (page: Page, rootId: string) =>
  page.locator(`[data-compact-room-view] [data-thread-root-id="${rootId}"]`);

const topOf = (card: Locator) => card.evaluate((element) => element.getBoundingClientRect().top);

/** Scrolls the card to the middle of the list, clear of the filter bar and the composer. */
const centerCard = (card: Locator) =>
  card.evaluate((element) => element.scrollIntoView({ block: 'center' }));

/** The root ID of the card under a point. */
const cardAt = (page: Page, point: { x: number; y: number }) =>
  page.evaluate(
    ({ x, y }) =>
      document
        .elementFromPoint(x, y)
        ?.closest('[data-thread-root-id]')
        ?.getAttribute('data-thread-root-id'),
    point
  );

/** The root IDs of the cards, top to bottom. */
const cardOrder = (page: Page) =>
  page
    .locator('[data-compact-room-view] [data-thread-root-id]')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-thread-root-id') ?? ''));

let replyRound = 0;
/** The agent answers in the three threads with the oldest activity, below the held card. */
const replyBelow = async (page: Page, room: SeededRoom) => {
  const targets = room.rootIds.slice(replyRound * 3, replyRound * 3 + 3);
  replyRound += 1;
  const bodies = targets.map((_rootId, index) => `Update ${replyRound}.${index}: tests pass now.`);
  for (const [index, rootId] of targets.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(getHomeserver(), room.agent.accessToken, room.roomId, {
      msgtype: 'm.text',
      body: bodies[index],
      'm.relates_to': threadRelation(rootId),
    });
  }
  // The cards know the replies (their previews show them) before the positions are read.
  for (const [index, rootId] of targets.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await expect(cardOf(page, rootId)).toContainText(bodies[index]!, { timeout: 30_000 });
  }
  // A frame for any re-sort to land.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      })
  );
  return targets;
};

/** After the reader lets go, the threads that got replies lead the list. */
const expectCaughtUp = async (page: Page, targets: string[]) => {
  await expect
    .poll(async () => (await cardOrder(page)).slice(0, 3).sort())
    .toEqual([...targets].sort());
};

const checkHeldOrder = async (page: Page, room: SeededRoom, engine: string) => {
  replyRound = 0;
  await expect(page.locator('[data-compact-room-view] [data-thread-root-id]')).toHaveCount(
    THREAD_COUNT,
    { timeout: 60_000 }
  );

  // 1. Hover: the card twelve from the top stays under the pointer.
  const order = await cardOrder(page);
  const held = cardOf(page, order[12]!);
  await centerCard(held);
  const box = (await held.boundingBox())!;
  const pointer = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(pointer.x, pointer.y);
  expect(await cardAt(page, pointer), `${engine}: the card under the pointer`).toBe(order[12]);
  await expect(page.locator('[data-order-held]')).toHaveCount(1);
  const before = await topOf(held);
  let targets = await replyBelow(page, room);
  expect(Math.abs((await topOf(held)) - before), `${engine}: hovered card moved`).toBeLessThan(1);
  expect(await cardAt(page, pointer), `${engine}: the card still under the pointer`).toBe(
    order[12]
  );
  // Leaving the list lets the new order in.
  await page.mouse.move(DESKTOP.width - 5, 5);
  await expectCaughtUp(page, targets);

  // 2. A card's menu: open from its More button, then the pointer leaves the list.
  const menuOrder = await cardOrder(page);
  const menuCard = cardOf(page, menuOrder[12]!);
  await centerCard(menuCard);
  const shell = page.locator(`[data-scroll-anchor="${menuOrder[12]}"]`);
  await shell.hover();
  await shell.getByRole('button', { name: 'Thread options' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.mouse.move(DESKTOP.width - 5, 5);
  const menuTop = await topOf(menuCard);
  targets = await replyBelow(page, room);
  expect(
    Math.abs((await topOf(menuCard)) - menuTop),
    `${engine}: card with menu moved`
  ).toBeLessThan(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.mouse.move(DESKTOP.width - 5, 5);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expectCaughtUp(page, targets);

  // 3. Keyboard focus on a card, with the pointer away. WebKit, like Safari by default, moves
  // Tab only between fields and links, not buttons, so this runs in Chromium.
  if (engine !== 'chromium') return;
  const focusOrder = await cardOrder(page);
  const focusCard = cardOf(page, focusOrder[12]!);
  await centerCard(focusCard);
  // Tab from the card above: keyboard focus, as a keyboard user reaches the card.
  await cardOf(page, focusOrder[11]!).focus();
  for (let step = 0; step < 8; step += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Tab');
    // eslint-disable-next-line no-await-in-loop
    if (await focusCard.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(focusCard).toBeFocused();
  expect(await focusCard.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
  const focusTop = await topOf(focusCard);
  targets = await replyBelow(page, room);
  expect(
    Math.abs((await topOf(focusCard)) - focusTop),
    `${engine}: focused card moved`
  ).toBeLessThan(1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expectCaughtUp(page, targets);
};

const openRoom = async (page: Page, room: SeededRoom) => {
  const homeserver = getHomeserver();
  await loginWithPassword(page, { homeserver, ...getPrimaryCredentials() });
  await expectLoggedInShellStable(page);
  await seedRoomOverviewState({
    page,
    roomId: room.roomId,
    userId: room.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(room.roomId)}`);
};

test.describe('compact cards hold their order while the reader interacts', () => {
  test.skip(!hasPrimaryCredentials(), 'Requires a Matrix test account');

  test('hover, a card menu and keyboard focus hold the order (Chromium)', async ({ page }) => {
    test.setTimeout(300_000);
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const me = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const room = await seedRoom(homeserver, me);
    await openRoom(page, room);
    await checkHeldOrder(page, room, 'chromium');
  });

  test('the same in WebKit', async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
    test.setTimeout(300_000);
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const me = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const room = await seedRoom(homeserver, me);
    const browser: Browser = await launchWebKit();
    try {
      const context = await browser.newContext({ viewport: DESKTOP, baseURL });
      const page = await context.newPage();
      await openRoom(page, room);
      await checkHeldOrder(page, room, 'webkit');
      await context.close();
    } finally {
      await browser.close();
    }
  });
});
