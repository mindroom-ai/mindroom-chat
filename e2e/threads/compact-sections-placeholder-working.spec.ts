import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  createDefaultThreadFilterState,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { withMovingMouseOverCard } from '../helpers/threadOverview';

// A pending Thinking placeholder counts as Working, but the card stays in its shown section
// while the reader holds the order. With Needs you above Working, moving down immediately
// would pull the card it leaves behind out from under the pointer.
const PASSWORD = 'thinking-placeholder-spec-password';
const RUN = Date.now().toString(36);
const ROOM_NAME = 'Placeholder Desk';

const inThread = (rootId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

/** The section header each card follows in the Compact room's sections. */
const sectionOf = (page: Page, rootId: string) =>
  page.evaluate((id) => {
    const card = document.querySelector(`[data-thread-root-id="${id}"]`);
    if (!card) return 'missing';
    const headers = [...document.querySelectorAll('[data-compact-section]')];
    let found = 'none';
    headers.forEach((header) => {
      // eslint-disable-next-line no-bitwise
      if (header.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING)
        found = header.getAttribute('data-compact-section') ?? 'none';
    });
    return found;
  }, rootId);

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a thread whose agent posted its Thinking placeholder is Working', async ({ page }) => {
  test.setTimeout(180_000);
  // Measure settled card positions, not the animation when a fixture card first arrives.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reader = await registerDisposableUser(`tpw_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, `thinker_${RUN}`);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(agent.userId)}/displayname`, {
    method: 'PUT',
    accessToken: agent.accessToken,
    body: JSON.stringify({ displayname: 'Helper' }),
  });
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const oldRoot = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'An older question',
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'An older answer',
    'io.mindroom.stream_status': 'completed',
    ...inThread(oldRoot),
  });

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.evaluate((userId) => {
    localStorage.setItem(`compactRoomSections:${userId}`, JSON.stringify({ on: true, folded: [] }));
  }, reader.userId);
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await expect(page.locator(`[data-thread-root-id="${oldRoot}"]`).first()).toBeVisible({
    timeout: 60_000,
  });

  const think = (rootId: string) =>
    sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Thinking...',
      format: 'org.matrix.custom.html',
      formatted_body: '<p>Thinking...</p>\n',
      'io.mindroom.stream_status': 'pending',
      ...inThread(rootId),
    });
  const card = (rootId: string) => page.locator(`[data-thread-root-id="${rootId}"]`).first();
  const orderHeld = () => page.locator('[data-order-held]').count();

  // (a) Pointer outside the cards.
  await page.mouse.move(5, 700);
  const rootA = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Question A with the pointer outside',
  });
  await expect(card(rootA)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => sectionOf(page, rootA), { timeout: 10_000 }).toBe('needsYou');
  await think(rootA);
  await expect.poll(() => sectionOf(page, rootA), { timeout: 10_000 }).toBe('working');

  // (b) Start a run on the card above the pointer, without moving the pointer.
  const rootB = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Question B above the pointer',
  });
  await expect(card(rootB)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => sectionOf(page, rootB), { timeout: 10_000 }).toBe('needsYou');
  const box = await card(oldRoot).boundingBox();
  if (!box) throw new Error('no card to point at');
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cardAtPoint = () =>
    page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest('[data-thread-root-id]')
          ?.getAttribute('data-thread-root-id'),
      point
    );
  await page.mouse.move(point.x, point.y);
  expect(await cardAtPoint()).toBe(oldRoot);
  // A press holds without the mouse-rest limit, even if the reply is slow to sync.
  await page.mouse.down();
  await expect.poll(orderHeld).toBe(1);
  const replyB = await think(rootB);
  const workingHeader = page.locator('[data-compact-section="working"]');
  await expect(workingHeader).toHaveText(/· 2$/);
  expect(await orderHeld()).toBe(1);
  expect(await sectionOf(page, rootB)).toBe('needsYou');
  expect(await cardAtPoint()).toBe(oldRoot);

  await page.mouse.move(5, 700);
  await page.mouse.up();
  await expect.poll(() => sectionOf(page, rootB)).toBe('working');
  expect(await orderHeld()).toBe(0);

  // (c) Keep the mouse moving until the finish syncs, then let it rest.
  await withMovingMouseOverCard(page, card(oldRoot), async () => {
    await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: '* Here are the fixes.',
      'm.new_content': {
        msgtype: 'm.text',
        body: 'Here are the fixes.',
        'io.mindroom.stream_status': 'completed',
      },
      'm.relates_to': { rel_type: 'm.replace', event_id: replyB },
    });
    await expect(workingHeader).toHaveText(/· 1$/, { timeout: 15_000 });
    expect(await sectionOf(page, rootB)).toBe('working');
    expect(await orderHeld()).toBe(1);
  });
  await expect.poll(() => sectionOf(page, rootB), { timeout: 10_000 }).toBe('needsYou');
  expect(await orderHeld()).toBe(0);
});
