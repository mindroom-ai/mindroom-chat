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
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Since Tuwunel v1.9.4-mindroom.31 (mindroom-tuwunel #140) a read receipt reads only up to the
// event it names: an older receipt, from another device that read up to an earlier event after
// newer ones arrived, leaves the events after it unread. The client read such a receipt up to
// when the server took it, so the room's overview showed a thread and two messages read that the
// server, the room's badge and the reader's other devices still counted.
//
// Alice asks a question and answers it in its thread, with two messages in the main timeline
// between and after the answers. The reader's other device reads the room up to the first answer
// (an unthreaded receipt), then the main timeline up to the first of the two messages. After
// each, every card of the room's overview (thread list and main timeline) and the room's badge in
// the room list must match the server's counts, also after a reload. Chromium on a desktop
// (1440 by 900, classic scrollbars) and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, WebKit on a phone (390 by 844, touch), against the disposable homeserver of a slot
// (scripts/e2e-slot.sh).
const PASSWORD = 'older-receipt-elsewhere-spec-password';
const RUN = Date.now().toString(36);
const FILLER_ROOMS = 25;
const ROOM_NAME = 'Venue Planning';
const QUESTION = 'Which venues are still open in the second week of May?';
const CATERING = 'The caterers sent their quote for the lunch on both days.';
const TRAVEL = 'Travel for the four invited speakers is booked and paid.';

const DESKTOP: BrowserContextOptions = { viewport: { width: 1440, height: 900 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
};

type World = {
  reader: DisposableUser;
  roomId: string;
  questionId: string;
  firstAnswerId: string;
  cateringId: string;
  travelId: string;
};

const seed = async (engine: string): Promise<World> => {
  const reader = await registerDisposableUser(`ore_${engine}_${RUN}`, PASSWORD);
  const alice = await registerDisposableUser(`ore_a_${engine}_${RUN}`, PASSWORD);
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index}` });
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [alice.userId],
  });
  await joinRoom(HOMESERVER, alice.accessToken, roomId);
  const send = async (body: string, rootId?: string) => {
    const eventId = await sendRoomMessage(HOMESERVER, alice.accessToken, roomId, {
      msgtype: 'm.text',
      body,
      ...(rootId
        ? {
            'm.relates_to': {
              rel_type: 'm.thread',
              event_id: rootId,
              is_falling_back: true,
              'm.in_reply_to': { event_id: rootId },
            },
          }
        : {}),
    });
    // The client orders events by their timestamps: no two may share a millisecond.
    await new Promise((resolve) => setTimeout(resolve, 5));
    return eventId;
  };
  const questionId = await send(QUESTION);
  const firstAnswerId = await send(
    'The harbour hall is free from the 11th to the 14th.',
    questionId
  );
  const cateringId = await send(CATERING);
  await send('The old library is open too, but only for 80 people.', questionId);
  await send('The garden pavilion is booked for a wedding that week.', questionId);
  const travelId = await send(TRAVEL);
  return { reader, roomId, questionId, firstAnswerId, cateringId, travelId };
};

/** A read receipt of the reader's, sent as another of their devices would. */
const readElsewhere = (world: World, eventId: string, threadId?: string) =>
  matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(world.roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`,
    {
      method: 'POST',
      accessToken: world.reader.accessToken,
      body: JSON.stringify(threadId ? { thread_id: threadId } : {}),
    }
  );

/** The server's unread counts for the room: its main timeline, and the question's thread. */
const serverCounts = async (world: World) => {
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
    { accessToken: world.reader.accessToken }
  );
  const room = sync.rooms?.join?.[world.roomId];
  return {
    main: room?.unread_notifications?.notification_count ?? 0,
    thread: room?.unread_thread_notifications?.[world.questionId]?.notification_count ?? 0,
  };
};

/** Whether each card of the room's overview shows as unread: the question, then the messages. */
const cards = (page: Page, world: World) =>
  Promise.all(
    [world.questionId, world.cateringId, world.travelId].map(async (eventId) => {
      const card = page.locator(`[data-thread-root-id="${eventId}"]`);
      const unread =
        (await card.getAttribute('data-thread-unread', { timeout: 15_000 })) === 'true';
      return unread ? 'unread' : 'read';
    })
  );

/** The overview's cards and the server's counts in one line, so a failure shows both. */
const overviewState = async (page: Page, world: World) => {
  const [[question, catering, travel], counts] = await Promise.all([
    cards(page, world),
    serverCounts(world),
  ]);
  return `question ${question}, catering ${catering}, travel ${travel}; server main ${counts.main}, thread ${counts.thread}`;
};

/** The number on the room's badge in the room list, or 0 without one. */
const rowCount = (page: Page, roomId: string): Promise<number> =>
  page.evaluate((id) => {
    const text = document.querySelector<HTMLElement>(`[data-room-id="${id}"]`)?.innerText;
    const match = /(\d+)\s*$/.exec(text?.trim() ?? '');
    return match ? Number(match[1]) : 0;
  }, roomId);

const openOverview = async (page: Page, world: World) => {
  await page.goto(`/home/${encodeURIComponent(world.roomId)}/`);
  await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
    timeout: 30_000,
  });
  for (const eventId of [world.questionId, world.cateringId, world.travelId])
    await expect(page.locator(`[data-thread-root-id="${eventId}"]`)).toBeVisible({
      timeout: 30_000,
    });
};

/** Expects `count` on the room's badge in the room list, which a phone shows instead of the room. */
const expectRoomListCount = async (page: Page, world: World, phone: boolean, count: number) => {
  if (phone) await page.goto('/home/');
  await expect(page.locator(`[data-room-id="${world.roomId}"]`).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect.poll(() => rowCount(page, world.roomId), { timeout: 30_000 }).toBe(count);
};

const check = async (
  browser: Browser,
  baseURL: string | undefined,
  engine: string,
  options: BrowserContextOptions
) => {
  const phone = !!options.isMobile;
  const world = await seed(engine);
  const context = await browser.newContext({ ...options, baseURL });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...world.reader });
    await seedRoomOverviewState({
      page,
      roomId: world.roomId,
      userId: world.reader.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });
    await openOverview(page, world);
    await expect
      .poll(() => overviewState(page, world), { timeout: 30_000 })
      .toBe('question unread, catering unread, travel unread; server main 3, thread 3');

    // Another device read the room up to the question's first answer, after every later event.
    await readElsewhere(world, world.firstAnswerId);
    await expect
      .poll(() => overviewState(page, world), { timeout: 30_000 })
      .toBe('question unread, catering unread, travel unread; server main 2, thread 2');

    // Then the main timeline up to the caterers' message, before the travel message.
    await readElsewhere(world, world.cateringId, 'main');
    await expect
      .poll(() => overviewState(page, world), { timeout: 30_000 })
      .toBe('question unread, catering read, travel unread; server main 1, thread 2');
    await expectRoomListCount(page, world, phone, 3);

    // A reload knows the receipts only from the saved sync and the server.
    await page.reload();
    await expectRoomListCount(page, world, phone, 3);
    if (phone) await openOverview(page, world);
    await expect
      .poll(() => overviewState(page, world), { timeout: 30_000 })
      .toBe('question unread, catering read, travel unread; server main 1, thread 2');
  } finally {
    await context.close();
  }
};

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('an older receipt from another device leaves the events after its event unread', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await check(browser, baseURL, 'chromium', DESKTOP);
});

test('an older receipt from another device leaves the events after its event unread (WebKit, phone)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  const browser = await launchWebKit();
  try {
    await check(browser, baseURL, 'webkit', PHONE);
  } finally {
    await browser.close();
  }
});
