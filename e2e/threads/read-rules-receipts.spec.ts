import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
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
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// The client reads a room as the server counts it (mindroom-tuwunel v1.9.4-mindroom.34), with the
// reader's other devices acting through the API:
//
// 1. An older unthreaded receipt, sent by a stale device after another device read the main
//    timeline further, never moves the main timeline's read position back: the server keeps one
//    receipt per context and only lowers counts. The SDK keeps one receipt for unthreaded and
//    `main` receipts together, so the messages between came back unread (P3-lane2-F001,
//    P3-lane4-F002).
// 2. A reply of the reader's in a thread reads only that thread: the server keeps counting the
//    root in the main timeline, and so does the room's badge (P3-lane4-F001, P3-lane5-F001).
// 3. An agent's title notice never makes its thread unread (design decision #17), also when it
//    arrives after the reader read the thread (P3-lane4-F004).
//
// Each check compares the overview's cards, the room's row and the client's count in the page
// title with the server's `/sync` counts, before and after a reload. Chromium on a desktop (1440
// by 900, classic scrollbars) and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit,
// WebKit on a phone (390 by 844, touch), against the disposable homeserver of a slot
// (scripts/e2e-slot.sh). Set READ_RULES_SHOTS to a directory to save the screen at the end.
const PASSWORD = 'read-rules-receipts-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.READ_RULES_SHOTS;
const FILLER_ROOMS = 25;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1440, height: 900 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
};

type Room = { reader: DisposableUser; roomId: string; name: string };

const inThread = (rootId: string, content: Record<string, unknown>) => ({
  ...content,
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

/** Sends a text message, in a thread when `rootId` is given. */
const sender =
  (session: MatrixSession, roomId: string) =>
  async (body: string, rootId?: string, extra: Record<string, unknown> = {}) => {
    const content = { msgtype: 'm.text', body, ...extra };
    const eventId = await sendRoomMessage(
      HOMESERVER,
      session.accessToken,
      roomId,
      rootId ? inThread(rootId, content) : content
    );
    // The client orders events by their timestamps: no two may share a millisecond.
    await new Promise((resolve) => setTimeout(resolve, 5));
    return eventId;
  };

/** A reader with enough rooms for a real room list, and a room with `others` in it. */
const seedRoom = async (
  key: string,
  name: string,
  others: MatrixSession[]
): Promise<Room & { reader: DisposableUser }> => {
  const reader = await registerDisposableUser(`rr_${key}_${RUN}`, PASSWORD);
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index}` });
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name,
    invite: others.map((other) => other.userId),
  });
  for (const other of others) await joinRoom(HOMESERVER, other.accessToken, roomId);
  return { reader, roomId, name };
};

/** A read receipt of the reader's, sent as another of their devices would. */
const readElsewhere = (room: Room, eventId: string, threadId?: string) =>
  matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(room.roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`,
    {
      method: 'POST',
      accessToken: room.reader.accessToken,
      body: JSON.stringify(threadId ? { thread_id: threadId } : {}),
    }
  );

/** The server's unread counts for the room: its main timeline, and every thread's. */
const serverCounts = async (room: Room) => {
  const filter = JSON.stringify({
    room: { timeline: { limit: 1, unread_thread_notifications: true } },
  });
  type Joined = {
    unread_notifications?: { notification_count?: number };
    unread_thread_notifications?: Record<string, { notification_count?: number }>;
  };
  const sync = await matrixFetch<{ rooms?: { join?: Record<string, Joined> } }>(
    HOMESERVER,
    `/sync?timeout=0&filter=${encodeURIComponent(filter)}`,
    { accessToken: room.reader.accessToken }
  );
  const joined = sync.rooms?.join?.[room.roomId];
  const threads = Object.values(joined?.unread_thread_notifications ?? {}).reduce(
    (sum, counts) => sum + (counts.notification_count ?? 0),
    0
  );
  return { main: joined?.unread_notifications?.notification_count ?? 0, threads };
};

/** Each card's read state, in the order given, by the overview's `data-thread-unread`. */
const cards = (page: Page, eventIds: string[]) =>
  Promise.all(
    eventIds.map(async (eventId) => {
      const card = page.locator(`[data-thread-root-id="${eventId}"]`).first();
      const unread =
        (await card.getAttribute('data-thread-unread', { timeout: 15_000 })) === 'true';
      return unread ? 'unread' : 'read';
    })
  );

/**
 * The overview's cards, the client's count in the page title and the server's counts in one
 * line, so a failure shows all of them.
 */
const overviewState = async (page: Page, room: Room, eventIds: string[]) => {
  const [states, counts, title] = await Promise.all([
    cards(page, eventIds),
    serverCounts(room),
    page.title(),
  ]);
  const client = /^\((\d+)\)/.exec(title)?.[1] ?? '0';
  return `cards ${states.join(' ')}; client ${client}; server main ${counts.main}, threads ${counts.threads}`;
};

const openOverview = async (page: Page, room: Room, eventIds: string[]) => {
  await page.goto(`/home/${encodeURIComponent(room.roomId)}/`);
  await expect(page.getByRole('heading', { name: room.name }).first()).toBeVisible({
    timeout: 30_000,
  });
  for (const eventId of eventIds)
    await expect(page.locator(`[data-thread-root-id="${eventId}"]`).first()).toBeVisible({
      timeout: 30_000,
    });
};

/** The room's row in the room list: its badge's number (0 without one) and its unread mark. */
const rowState = (page: Page, roomId: string): Promise<string> =>
  page.evaluate((id) => {
    const row = document.querySelector<HTMLElement>(`[data-room-id="${id}"]`);
    const match = /(\d+)\s*$/.exec(row?.innerText.trim() ?? '');
    const marked = row?.querySelector('[data-highlight]')?.getAttribute('data-highlight');
    return `badge ${match ? match[1] : 0}, ${marked === 'true' ? 'unread' : 'read'}`;
  }, roomId);

/** Expects the room's row to read `state`; a phone shows the list in place of the room. */
const expectRow = async (page: Page, room: Room, phone: boolean, state: string) => {
  if (phone) await page.goto('/home/');
  await expect(page.locator(`[data-room-id="${room.roomId}"]`).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect.poll(() => rowState(page, room.roomId), { timeout: 30_000 }).toBe(state);
};

type Check = (page: Page, phone: boolean, engine: string) => Promise<void>;

const signIn = async (page: Page, room: Room) => {
  await loginWithPassword(page, { homeserver: HOMESERVER, ...room.reader });
  await seedRoomOverviewState({
    page,
    roomId: room.roomId,
    userId: room.reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
};

/** Checks the overview and the room's row, then both again after a reload. */
const expectSettled = async (
  page: Page,
  phone: boolean,
  room: Room,
  eventIds: string[],
  overview: string,
  row: string
) => {
  await expect
    .poll(() => overviewState(page, room, eventIds), { timeout: 30_000 })
    .toBe(overview);
  await expectRow(page, room, phone, row);
  await page.reload();
  await expectRow(page, room, phone, row);
  await openOverview(page, room, eventIds);
  await expect
    .poll(() => overviewState(page, room, eventIds), { timeout: 30_000 })
    .toBe(overview);
};

const olderUnthreadedReceipt: Check = async (page, phone, engine) => {
  const alice = await registerDisposableUser(`rr_a1_${engine}_${RUN}`, PASSWORD);
  const room = await seedRoom(`older_${engine}`, 'Venue Planning', [alice]);
  const send = sender(alice, room.roomId);
  const question = await send('Which venues are still open in the second week of May?');
  const firstAnswer = await send('The harbour hall is free from the 11th to the 14th.', question);
  const catering = await send('The caterers sent their quote for the lunch on both days.');
  const secondAnswer = await send('The old library is open too, but only for 80 people.', question);
  const travel = await send('Travel for the four invited speakers is booked and paid.');
  const ids = [question, catering, travel];

  await signIn(page, room);
  await openOverview(page, room, ids);
  await expect
    .poll(() => overviewState(page, room, ids), { timeout: 30_000 })
    .toBe('cards unread unread unread; client 5; server main 3, threads 2');

  // Another device read the main timeline to its end.
  await readElsewhere(room, travel, 'main');
  await expect
    .poll(() => overviewState(page, room, ids), { timeout: 30_000 })
    .toBe('cards unread read read; client 2; server main 0, threads 2');

  // A stale device's Mark as Read: an unthreaded receipt on the newest event it held, the first
  // answer, taken after the main receipt.
  await readElsewhere(room, firstAnswer);
  await expect
    .poll(() => overviewState(page, room, ids), { timeout: 30_000 })
    .toBe('cards unread read read; client 1; server main 0, threads 1');

  // The thread read to its end: nothing is unread anywhere.
  await readElsewhere(room, secondAnswer, question);
  await expectSettled(
    page,
    phone,
    room,
    ids,
    'cards read read read; client 0; server main 0, threads 0',
    'badge 0, read'
  );
};

const ownThreadReply: Check = async (page, phone, engine) => {
  const alice = await registerDisposableUser(`rr_a2_${engine}_${RUN}`, PASSWORD);
  const room = await seedRoom(`own_${engine}`, 'Hiring Plan', [alice]);
  const send = sender(alice, room.roomId);
  const root = await send('Can someone review the interview questions for Thursday?');
  await send('I added two questions about the on-call rotation.', root);
  const ids = [root];

  await signIn(page, room);
  await openOverview(page, room, ids);
  await expect
    .poll(() => overviewState(page, room, ids), { timeout: 30_000 })
    .toBe('cards unread; client 2; server main 1, threads 1');

  // The reader answers in the thread from another device: that reads the thread, not the root.
  await sender(room.reader, room.roomId)('Looks good to me, thanks.', root);
  await expectSettled(
    page,
    phone,
    room,
    ids,
    'cards unread; client 1; server main 1, threads 0',
    'badge 1, unread'
  );
};

const titleNoticeThreads: Check = async (page, phone, engine) => {
  const alice = await registerDisposableUser(`rr_a3_${engine}_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, `planner_${engine}`);
  const room = await seedRoom(`title_${engine}`, 'Release Desk', [alice, agent]);
  const send = sender(alice, room.roomId);
  const title = (rootId: string, summary: string) =>
    sender(agent, room.roomId)(summary, rootId, {
      msgtype: 'm.notice',
      'io.mindroom.thread_summary': { version: 1, summary },
    });
  const answered = await send('Is the release checklist ready for Friday?');
  const answer = await sender(agent, room.roomId)('Yes, every item is checked.', answered);
  const titledOnly = await send('Reminder: the office is closed on Monday.');
  await title(titledOnly, 'Office closed Monday');
  const ids = [answered, titledOnly];

  await signIn(page, room);
  // Another device read the main timeline and the answered thread.
  await readElsewhere(room, titledOnly, 'main');
  await readElsewhere(room, answer, answered);
  await openOverview(page, room, ids);
  await expect
    .poll(() => overviewState(page, room, ids), { timeout: 30_000 })
    .toBe('cards read read; client 0; server main 0, threads 0');

  // The agent titles the thread the reader read.
  await title(answered, 'Release checklist');
  await expectSettled(
    page,
    phone,
    room,
    ids,
    'cards read read; client 0; server main 0, threads 0',
    'badge 0, read'
  );
  // The Unread filter, one of the agent rooms' advanced filters, finds no thread.
  const advancedFilters = page.locator('[data-thread-filter-mode-switch]');
  if ((await advancedFilters.getAttribute('aria-pressed')) !== 'true')
    await advancedFilters.click();
  await expect(advancedFilters).toHaveAttribute('aria-pressed', 'true');
  const unreadFilter = page.locator('[data-filter-key="unread"]');
  await unreadFilter.click();
  await expect(unreadFilter).toHaveAttribute('data-filter-state', 'include');
  await expect(page.locator('[data-thread-root-id]')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/read-rules-titles-${engine}.png` });
};

const run = async (
  browser: Browser,
  baseURL: string | undefined,
  options: BrowserContextOptions,
  engine: string,
  check: Check
) => {
  const context = await browser.newContext({ ...options, baseURL });
  const page = await context.newPage();
  try {
    await check(page, !!options.isMobile, engine);
  } finally {
    await context.close();
  }
};

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const CHECKS: Array<[string, Check]> = [
  ['an older unthreaded receipt leaves the main timeline read', olderUnthreadedReceipt],
  ["the reader's thread reply leaves the root counted", ownThreadReply],
  ['a title notice leaves its thread read', titleNoticeThreads],
];

for (const [name, check] of CHECKS) {
  test(name, async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    await run(browser, baseURL, DESKTOP, 'chromium', check);
  });

  test(`${name} (WebKit, phone)`, async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(240_000);
    const browser = await launchWebKit();
    try {
      await run(browser, baseURL, PHONE, 'webkit', check);
    } finally {
      await browser.close();
    }
  });
}
