import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
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
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// An agent streams its reply as one message that `m.replace` edits keep growing; the edit whose
// `io.mindroom.stream_status` is terminal finishes it. The server counts the finished reply as a
// new unread message, so a reader who watches the reply finish has to send a receipt that reaches
// that edit, as they do when they watch a new message arrive. Against the disposable homeserver of
// a slot (scripts/e2e-slot.sh), on a phone (390 by 844, touch) and a desktop (1280 by 800), in
// Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit:
// - watching the thread: a thread receipt on the finishing edit, accepted by the server, and the
//   thread stays read, also after a reload;
// - in another room: no receipt, until the reader opens the thread and sees the finished reply;
// - on another device, both threads stay read;
// - a reply in the main timeline: a main receipt on the finishing edit;
// - the window without focus: no receipt until the window gets its focus back;
// - read half-way, then finished while the reader is on the thread list: the card is unread
//   until the reader opens the thread again.
// Set STREAM_RECEIPT_SHOTS=<directory> to save the thread after each finished reply.
const PASSWORD = 'stream-finish-receipt-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.STREAM_RECEIPT_SHOTS;
const ROOM_NAME = 'Release Desk';
const OTHER_ROOM_NAME = 'Design Desk';
const MAIN_ROOM_NAME = 'Ops Desk';
const FILLER_ROOMS = 24;
const HISTORY = 30;
/** How long a receipt that should not come gets to show up anyway. */
const QUIET_MS = 3_000;
/** How late each frame comes in the unfocused case, as on a busy machine. */
const SLOW_FRAME_MS = 4_000;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

const STREAM_STEPS = [
  'Checking the release notes against the merged changes.',
  'Checking the release notes against the merged changes. Two entries are missing: the export fix and the new keyboard shortcuts.',
];
const finished = (label: string) =>
  `Ready for ${label}: I added the export fix and the keyboard shortcuts to the release notes and moved the migration note to the top, since every operator must act on it before the upgrade.`;

type Account = MatrixSession & { username: string };

const inThread = (rootId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

type World = {
  reader: Account;
  agent: MatrixSession;
  roomId: string;
  otherRoomId: string;
  /** A room in the Classic view, which shows its main timeline with the newest message last. */
  mainRoomId: string;
};

const seed = async (engine: string): Promise<World> => {
  const reader = await registerDisposableUser(`sfr_${engine}_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, `release_${engine}`);
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
  const mainRoomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: MAIN_ROOM_NAME,
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, mainRoomId);
  const otherRoomId = await createRoom(HOMESERVER, reader.accessToken, { name: OTHER_ROOM_NAME });
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index}` });
  for (const historyRoomId of [roomId, mainRoomId])
    for (let index = 1; index <= HISTORY; index += 1) {
      const fromAgent = index % 2 === 0;
      await sendRoomMessage(HOMESERVER, (fromAgent ? agent : reader).accessToken, historyRoomId, {
        msgtype: 'm.text',
        body: fromAgent
          ? `Release item ${index}: the build passed, the changelog is drafted, and the staging deploy is waiting for the last review.`
          : `Release item ${index}: what is still open before we tag?`,
        ...(fromAgent ? { 'io.mindroom.stream_status': 'completed' } : {}),
      });
    }
  await sendRoomMessage(HOMESERVER, reader.accessToken, otherRoomId, {
    msgtype: 'm.text',
    body: 'Mockups for the settings page are in the shared folder.',
  });
  return { reader, agent, roomId, otherRoomId, mainRoomId };
};

type SentReceipt = { eventId: string; threadId?: string; status?: number };

const receiptPath = (url: string) => /\/receipt\/[^/]+\/([^/?]+)/.exec(url);

/** The event a read receipt request names, and its thread. */
const parseReceipt = (request: Request): SentReceipt | undefined => {
  const path = receiptPath(request.url());
  if (request.method() !== 'POST' || !path) return undefined;
  const { thread_id: threadId } = (request.postDataJSON() ?? {}) as { thread_id?: string };
  return { eventId: decodeURIComponent(path[1] ?? ''), threadId };
};

/** The read receipts the page sends, in order, each with the server's answer once it came. */
const recordReceipts = (page: Page): SentReceipt[] => {
  const sent: SentReceipt[] = [];
  const byRequest = new Map<Request, SentReceipt>();
  page.on('request', (request: Request) => {
    const receipt = parseReceipt(request);
    if (!receipt) return;
    sent.push(receipt);
    byRequest.set(request, receipt);
  });
  page.on('response', (response: Response) => {
    const receipt = byRequest.get(response.request());
    if (receipt) receipt.status = response.status();
  });
  return sent;
};

/** Each receipt for `eventId`, as `<thread> <status>`. */
const receiptsFor = (receipts: SentReceipt[], eventId: string) =>
  receipts
    .filter((receipt) => receipt.eventId === eventId)
    .map((receipt) => `${receipt.threadId ?? 'unthreaded'} ${receipt.status ?? 'pending'}`);

const navigate = async (page: Page, route: string) => {
  await page.evaluate((target) => {
    window.history.pushState(null, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
};

const roomRoute = (roomId: string) => `/home/${encodeURIComponent(roomId)}/`;
const threadRoute = (roomId: string, rootId: string) =>
  `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`;

const focusPage = async (page: Page) => {
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
};

/** Takes the window's focus away, as when the reader switches to another application. */
const blurWindow = (page: Page) =>
  page.evaluate(() => {
    document.hasFocus = () => false;
    window.dispatchEvent(new Event('blur'));
  });

/** Gives the window its focus back. */
const refocusWindow = (page: Page) =>
  page.evaluate(() => {
    delete (document as { hasFocus?: () => boolean }).hasFocus;
    window.dispatchEvent(new Event('focus'));
  });

const text = (page: Page, body: string) => page.getByText(body, { exact: true }).last();

/** Starts a reply as MindRoom does: a message marked as streaming. */
const startStream = (world: World, rootId?: string, roomId = world.roomId) =>
  sendRoomMessage(HOMESERVER, world.agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: STREAM_STEPS[0],
    'io.mindroom.stream_status': 'streaming',
    ...(rootId ? inThread(rootId) : {}),
  });

const streamEdit = (
  world: World,
  replyId: string,
  body: string,
  status: string,
  roomId = world.roomId
) =>
  sendRoomMessage(HOMESERVER, world.agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: `* ${body}`,
    'm.new_content': { msgtype: 'm.text', body, 'io.mindroom.stream_status': status },
    'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
  });

/**
 * Streams the reply's next step, then finishes it; returns the finishing edit's ID. With `shown`,
 * waits until the page shows the step before finishing.
 */
const finishStream = async (
  world: World,
  replyId: string,
  label: string,
  shown?: (body: string) => Locator,
  roomId = world.roomId
) => {
  await streamEdit(world, replyId, STREAM_STEPS[1]!, 'streaming', roomId);
  if (shown) await expect(shown(STREAM_STEPS[1]!)).toBeVisible({ timeout: 30_000 });
  return streamEdit(world, replyId, finished(label), 'completed', roomId);
};

const askQuestion = (world: World, question: string) =>
  sendRoomMessage(HOMESERVER, world.reader.accessToken, world.roomId, {
    msgtype: 'm.text',
    body: question,
  });

/** How many of the thread's replies the server still counts for the reader. */
const serverThreadCount = async (world: World, rootId: string) => {
  const filter = JSON.stringify({
    room: { timeline: { limit: 1, unread_thread_notifications: true } },
  });
  const sync = await matrixFetch<{
    rooms?: {
      join?: Record<
        string,
        { unread_thread_notifications?: Record<string, { notification_count?: number }> }
      >;
    };
  }>(HOMESERVER, `/sync?timeout=0&filter=${encodeURIComponent(filter)}`, {
    accessToken: world.reader.accessToken,
  });
  return (
    sync.rooms?.join?.[world.roomId]?.unread_thread_notifications?.[rootId]?.notification_count ??
    0
  );
};

const threadCard = (page: Page, rootId: string) =>
  page.locator(`[data-thread-root-id="${rootId}"]`).first();

const expectThreadRead = async (page: Page, rootId: string) => {
  await expect(threadCard(page, rootId)).toBeVisible({ timeout: 30_000 });
  await expect(threadCard(page, rootId)).not.toHaveAttribute('data-thread-unread', 'true');
};

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** (a) The reader watches the thread while the reply finishes. */
const watchThread = async (page: Page, world: World, receipts: SentReceipt[], label: string) => {
  const rootId = await askQuestion(world, `What is left before the ${label} release?`);
  const replyId = await startStream(world, rootId);
  await navigate(page, threadRoute(world.roomId, rootId));
  await expect(text(page, STREAM_STEPS[0]!)).toBeVisible({ timeout: 30_000 });
  // Opening the thread reads the reply as far as it has streamed.
  await expect
    .poll(() => receiptsFor(receipts, replyId), { timeout: 30_000 })
    .toContain(`${rootId} 200`);

  const finishId = await finishStream(world, replyId, label, (body) => text(page, body));
  await expect(text(page, finished(label))).toBeVisible({ timeout: 30_000 });
  // Accepted by the server: a receipt on an edit belongs to the thread of the reply it edits.
  await expect
    .poll(() => receiptsFor(receipts, finishId), { timeout: 15_000 })
    .toEqual([`${rootId} 200`]);
  await shot(page, `${label}-thread-finished`);
  expect(await serverThreadCount(world, rootId)).toBe(0);

  await navigate(page, roomRoute(world.roomId));
  await expectThreadRead(page, rootId);
  await page.reload();
  await expectThreadRead(page, rootId);
  return rootId;
};

/** (b) The reader is in another room while the reply finishes. */
const elsewhere = async (page: Page, world: World, receipts: SentReceipt[], label: string) => {
  const rootId = await askQuestion(world, `Who signs off the ${label} notes?`);
  await navigate(page, roomRoute(world.otherRoomId));
  await expect(
    page.getByText('Mockups for the settings page are in the shared folder.').last()
  ).toBeVisible({ timeout: 30_000 });
  const replyId = await startStream(world, rootId);
  const finishId = await finishStream(world, replyId, label);
  await page.waitForTimeout(QUIET_MS);
  expect(receiptsFor(receipts, finishId)).toEqual([]);
  expect(receipts.filter((receipt) => receipt.threadId === rootId)).toEqual([]);

  // Opening the thread later shows the finished reply: now it is read, up to its finishing edit.
  await navigate(page, threadRoute(world.roomId, rootId));
  await expect(text(page, finished(label))).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => receiptsFor(receipts, finishId), { timeout: 15_000 })
    .toEqual([`${rootId} 200`]);
  return rootId;
};

/** (c) A reply in the main timeline finishes while the reader is at its bottom. */
const mainTimeline = async (page: Page, world: World, receipts: SentReceipt[], label: string) => {
  await navigate(page, roomRoute(world.mainRoomId));
  await expect(page.getByRole('heading', { name: MAIN_ROOM_NAME }).first()).toBeVisible({
    timeout: 30_000,
  });
  const replyId = await startStream(world, undefined, world.mainRoomId);
  await expect(text(page, STREAM_STEPS[0]!)).toBeVisible({ timeout: 30_000 });
  const finishId = await finishStream(
    world,
    replyId,
    label,
    (body) => text(page, body),
    world.mainRoomId
  );
  await expect(text(page, finished(label))).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => receiptsFor(receipts, finishId), { timeout: 15_000 })
    .toEqual(['main 200']);
  await shot(page, `${label}-main-finished`);
};

/** (d) The reader has the thread open, but the window has no focus while the reply finishes. */
const unfocused = async (page: Page, world: World, receipts: SentReceipt[], label: string) => {
  const rootId = await askQuestion(world, `Can the ${label} tag wait until Monday?`);
  const replyId = await startStream(world, rootId);
  // A busy machine: the frame after the thread opens comes late, after the window lost its
  // focus and the reply finished. A read decided before must not send its receipt then.
  await page.evaluate((delay) => {
    const frame = window.requestAnimationFrame.bind(window);
    const slow = (callback: FrameRequestCallback) =>
      frame(() => {
        window.setTimeout(() => callback(performance.now()), delay);
      });
    Object.assign(window, { restoreFrames: () => Object.assign(window, { requestAnimationFrame: frame }) });
    window.requestAnimationFrame = slow;
  }, SLOW_FRAME_MS);
  await navigate(page, threadRoute(world.roomId, rootId));
  await expect(text(page, STREAM_STEPS[0]!)).toBeVisible({ timeout: 30_000 });
  await blurWindow(page);
  const finishId = await finishStream(world, replyId, label, (body) => text(page, body));
  await expect(text(page, finished(label))).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(QUIET_MS + SLOW_FRAME_MS);
  expect(receiptsFor(receipts, finishId)).toEqual([]);
  await page.evaluate(() => (window as unknown as { restoreFrames: () => void }).restoreFrames());

  // Back in the window, still at the bottom of the thread: now the reader has seen it.
  await refocusWindow(page);
  await expect
    .poll(() => receiptsFor(receipts, finishId), { timeout: 15_000 })
    .toEqual([`${rootId} 200`]);
};

/**
 * (e) The reader reads the reply half-way, goes back to the thread list, and the reply finishes
 * there: its card is unread, as the server counts it, until the reader opens the thread again.
 */
const readHalfWay = async (page: Page, world: World, receipts: SentReceipt[], label: string) => {
  const rootId = await askQuestion(world, `Which ${label} fixes go into the notes?`);
  const replyId = await startStream(world, rootId);
  await navigate(page, threadRoute(world.roomId, rootId));
  await expect(text(page, STREAM_STEPS[0]!)).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => receiptsFor(receipts, replyId), { timeout: 30_000 })
    .toContain(`${rootId} 200`);
  await navigate(page, roomRoute(world.roomId));
  await expectThreadRead(page, rootId);

  const finishId = await finishStream(world, replyId, label);
  await expect(threadCard(page, rootId)).toHaveAttribute('data-thread-unread', 'true', {
    timeout: 30_000,
  });
  await shot(page, `${label}-card-unread`);
  expect(receiptsFor(receipts, finishId)).toEqual([]);

  await navigate(page, threadRoute(world.roomId, rootId));
  await expect(text(page, finished(label))).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => receiptsFor(receipts, finishId), { timeout: 15_000 })
    .toEqual([`${rootId} 200`]);
  await navigate(page, roomRoute(world.roomId));
  await expectThreadRead(page, rootId);
};

const check = async (page: Page, world: World, label: string) => {
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await seedRoomOverviewState({
    page,
    roomId: world.mainRoomId,
    userId: world.reader.userId,
    // The Classic view: the main timeline in time order, the newest message at the bottom.
    viewMode: 'classic',
  });
  const receipts = recordReceipts(page);
  await focusPage(page);
  await page.goto(roomRoute(world.roomId));
  await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
    timeout: 60_000,
  });
  await focusPage(page);
  const watched = await watchThread(page, world, receipts, `${label} watched`);
  await focusPage(page);
  const openedLater = await elsewhere(page, world, receipts, `${label} elsewhere`);
  await mainTimeline(page, world, receipts, `${label} main`);
  await unfocused(page, world, receipts, `${label} unfocused`);
  await focusPage(page);
  await readHalfWay(page, world, receipts, `${label} half-way`);
  return [watched, openedLater];
};

/**
 * On another device, whose client loads each reply with its newest edit bundled rather than the
 * edits themselves, the threads read through their finishing edits stay read.
 */
const checkOtherDevice = async (
  browser: Browser,
  options: BrowserContextOptions,
  world: World,
  rootIds: string[]
) => {
  const context = await browser.newContext(options);
  try {
    const page = await context.newPage();
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    await seedRoomOverviewState({
      page,
      roomId: world.roomId,
      userId: world.reader.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });
    await page.goto(roomRoute(world.roomId));
    for (const rootId of rootIds) await expectThreadRead(page, rootId);
  } finally {
    await context.close();
  }
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  for (const [viewport, options] of [
    ['phone', PHONE],
    ['desktop', DESKTOP],
  ] as const) {
    const context = await browser.newContext({ ...options, baseURL });
    try {
      const page = await context.newPage();
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: world.reader.username,
        password: PASSWORD,
      });
      const readRoots = await check(page, world, `${engine} ${viewport}`);
      await checkOtherDevice(browser, { ...options, baseURL }, world, readRoots);
    } finally {
      await context.close();
    }
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a streamed reply the reader watches finish gets a receipt (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(420_000);
  await run(browser, baseURL, 'chromium');
});

test('a streamed reply the reader watches finish gets a receipt (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(420_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
