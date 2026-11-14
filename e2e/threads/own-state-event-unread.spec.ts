import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import {
  createDefaultThreadFilterState,
  joinRoom,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A thread tag is room state, and the server reads nothing for a member's own state event: the
// room's unread messages stay unread. The client must count them too, when the reader's tag,
// put from another device, is the newest event of the room's main timeline: after signing in,
// after a reload, and after opening the tagged thread. Runs in Chromium on a desktop and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit on a phone, against the
// disposable homeserver of `just hs-up` (or a slot of scripts/e2e-slot.sh).
const PASSWORD = 'own-state-event-unread-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.OWN_STATE_UNREAD_SHOTS;

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

type SyncRoom = {
  unread_notifications?: { notification_count?: number };
  unread_thread_notifications?: Record<string, { notification_count?: number }>;
};

/** The reader's unread count of the room on the server: main timeline plus every thread. */
const serverTotal = async (reader: DisposableUser, roomId: string): Promise<number> => {
  const filter = JSON.stringify({
    room: { rooms: [roomId], timeline: { limit: 1, unread_thread_notifications: true } },
  });
  const sync = await matrixFetch<{ rooms?: { join?: Record<string, SyncRoom> } }>(
    HOMESERVER,
    `/sync?timeout=0&filter=${encodeURIComponent(filter)}`,
    { accessToken: reader.accessToken }
  );
  const room = sync.rooms?.join?.[roomId];
  const threads = Object.values(room?.unread_thread_notifications ?? {}).reduce(
    (sum, counts) => sum + (counts.notification_count ?? 0),
    0
  );
  return (room?.unread_notifications?.notification_count ?? 0) + threads;
};

/** The count the room's row in the room list shows; 0 without a count. */
const rowCount = (page: Page, roomName: string): Promise<number> =>
  page
    .locator('[data-highlight]')
    .filter({ has: page.getByRole('link', { name: roomName }) })
    .first()
    .evaluate((row) => {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let count = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim() ?? '';
        if (/^\d+$/.test(text)) count = Number(text);
      }
      return count;
    })
    .catch(() => -1);

const reply = (rootId: string, body: string) => ({
  msgtype: 'm.text',
  body,
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

const ownTagKeepsUnread = async (page: Page, label: string, phone: boolean) => {
  const reader = await registerDisposableUser(`osu_reader_${label}_${RUN}`, PASSWORD);
  const colleague = await registerDisposableUser(`osu_colleague_${label}_${RUN}`, PASSWORD);
  const roomName = `Release desk ${label}`;
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: roomName,
    invite: [colleague.userId],
  });
  await joinRoom(HOMESERVER, colleague.accessToken, roomId);
  const send = (content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, colleague.accessToken, roomId, content);
  const rootId = await send({
    msgtype: 'm.text',
    body: 'Release checklist for the mobile app: who signs off on the store listing?',
  });
  await send(reply(rootId, 'I can take the screenshots once the copy is final.'));
  await send(reply(rootId, 'Copy is final as of this morning, the legal review passed too.'));
  await send({
    msgtype: 'm.text',
    body: 'Reminder: the staging freeze starts at 18:00 today, please merge before then.',
  });
  // The reader tags the thread from another device: their own state event, now the newest.
  await sendStateEvent(
    HOMESERVER,
    reader.accessToken,
    roomId,
    'com.mindroom.thread.tags',
    JSON.stringify([rootId, 'release']),
    { set_by: reader.userId, set_at: new Date().toISOString() }
  );
  // Root and main message unread in the main timeline, two replies in the thread.
  await expect.poll(() => serverTotal(reader, roomId), { timeout: 15_000 }).toBe(4);

  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  if (phone) await page.goto('/home/');
  const matchesServer = async (step: string) => {
    const expected = await serverTotal(reader, roomId);
    await expect
      .poll(() => rowCount(page, roomName), { message: `room row count ${step}`, timeout: 20_000 })
      .toBe(expected);
    // Long enough for a late correction of the count, which must not come.
    await page.waitForTimeout(2_000);
    expect(await rowCount(page, roomName), `room row count ${step}, settled`).toBe(
      await serverTotal(reader, roomId)
    );
  };
  await matchesServer('after signing in');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/own-state-unread-${label}-signed-in.png` });

  await page.reload();
  await matchesServer('after a reload');

  // Opening the tagged thread reads its replies, and only them.
  await page.goto(`/home/${encodeURIComponent(roomId)}/${encodeURIComponent(rootId)}`);
  await expect(page.getByText('Copy is final as of this morning').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect.poll(() => serverTotal(reader, roomId), { timeout: 15_000 }).toBe(2);
  if (phone) await page.goto('/home/');
  await matchesServer('after opening the tagged thread');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/own-state-unread-${label}-thread-read.png` });
};

test('the reader’s own thread tag leaves the room’s unread messages counted (Chromium)', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await ownTagKeepsUnread(page, 'chromium', false);
});

test('the reader’s own thread tag leaves the room’s unread messages counted (WebKit phone)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  await onWebKitPage(
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL },
    (page) => ownTagKeepsUnread(page, 'webkit', true)
  );
});

/**
 * P2-lane5-F003: the reader renames themselves, then pins a message, each from another device.
 * The rename is an own member event in every room, the pin an own state event in this one; a
 * reload restores the saved sync that holds them, and the row keeps the server's count.
 */
const ownProfileAndPinKeepUnread = async (page: Page, label: string, phone: boolean) => {
  const reader = await registerDisposableUser(`opu_reader_${label}_${RUN}`, PASSWORD);
  const colleague = await registerDisposableUser(`opu_colleague_${label}_${RUN}`, PASSWORD);
  const roomName = `Launch desk ${label}`;
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: roomName,
    invite: [colleague.userId],
  });
  await joinRoom(HOMESERVER, colleague.accessToken, roomId);
  const send = (content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, colleague.accessToken, roomId, content);
  const rootId = await send({
    msgtype: 'm.text',
    body: 'Launch plan for the web app: who checks the pricing page before it goes live?',
  });
  await send(reply(rootId, 'I will read the pricing page after lunch and leave notes here.'));
  const mainId = await send({
    msgtype: 'm.text',
    body: 'The analytics dashboard is back up after the maintenance window this morning.',
  });
  await send({
    msgtype: 'm.text',
    body: 'Please add your launch day availability to the shared calendar by Friday.',
  });
  await expect.poll(() => serverTotal(reader, roomId), { timeout: 15_000 }).toBe(4);

  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  if (phone) await page.goto('/home/');
  const matchesServer = async (step: string) => {
    const expected = await serverTotal(reader, roomId);
    expect(expected, `server count ${step}`).toBe(4);
    await expect
      .poll(() => rowCount(page, roomName), { message: `room row count ${step}`, timeout: 20_000 })
      .toBe(expected);
    await page.waitForTimeout(2_000);
    expect(await rowCount(page, roomName), `room row count ${step}, settled`).toBe(expected);
  };
  await matchesServer('after signing in');

  // Another device renames the reader; the saved sync takes the member event within 10 s.
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(reader.userId)}/displayname`, {
    method: 'PUT',
    accessToken: reader.accessToken,
    body: JSON.stringify({ displayname: `Reader Renamed ${label}` }),
  });
  await matchesServer('after the rename');
  await page.waitForTimeout(12_000);
  await page.reload();
  await matchesServer('after the rename and a reload');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/own-profile-unread-${label}-reloaded.png` });

  // Another device pins a message for the room: the reader's own state event in this room.
  await sendStateEvent(HOMESERVER, reader.accessToken, roomId, 'm.room.pinned_events', '', {
    pinned: [mainId],
  });
  await matchesServer('after the pin');
  await page.waitForTimeout(12_000);
  await page.reload();
  await matchesServer('after the pin and a reload');
};

test('the reader’s own rename and pin leave the room’s unread messages counted after a reload (Chromium)', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await ownProfileAndPinKeepUnread(page, 'chromium', false);
});

test('the reader’s own rename and pin leave the room’s unread messages counted after a reload (WebKit phone)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  await onWebKitPage(
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL },
    (page) => ownProfileAndPinKeepUnread(page, 'webkit', true)
  );
});
