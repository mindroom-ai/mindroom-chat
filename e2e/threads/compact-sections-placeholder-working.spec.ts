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

// MindRoom posts a "Thinking..." placeholder marked `io.mindroom.stream_status: pending` as soon
// as an agent starts on a message, and the workflow classifier counts it as Working. In the Compact
// room's sections, the card must move to Working then, also while the mouse rests on the cards
// (which otherwise holds every card in the section it showed in). Against the disposable
// homeserver of a slot (scripts/e2e-slot.sh).
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

  // (b) The mouse rests on another card, which holds every other move.
  const rootB = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Question B with the mouse resting on a card',
  });
  await expect(card(rootB)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => sectionOf(page, rootB), { timeout: 10_000 }).toBe('needsYou');
  await card(oldRoot).hover();
  await expect.poll(orderHeld, { timeout: 5_000 }).toBe(1);
  await think(rootB);
  await expect.poll(() => sectionOf(page, rootB), { timeout: 10_000 }).toBe('working');
  expect(await orderHeld()).toBe(1);
});
