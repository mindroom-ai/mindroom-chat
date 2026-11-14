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

// A /sync answer carries at most 20 events per room (`limited: true` past that): a page that falls
// behind, as a loaded phone does while 20 agents stream, never sees the events in the gap. The
// room's cache fills such a gap from /messages in the background, but under that load the fill
// falls behind too; the room's Compact view must still show a thread that started and finished in
// the gap, and the finished reply and title of a thread whose card was on screen when its reply
// started, not its first streamed text. The spec holds the cache's gap fill back to make that state
// certain. Against the disposable homeserver of a slot (scripts/e2e-slot.sh), on a
// phone (390 by 844, touch) and a desktop (1280 by 800), in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set THREAD_GAP_SHOTS=<directory>
// to save the list after the gap.
const PASSWORD = 'thread-list-sync-gap-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.THREAD_GAP_SHOTS;
const ROOM_NAME = 'Release Desk';
const FILLER_ROOMS = 24;
const HISTORY = 30;
/** Far more than the sync filter's 20 events per room, as when 20 agents stream: a deep gap. */
const BUSY_REPLIES = 120;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

const PLACEHOLDER = 'Thinking...';
const FIRST_STEP = 'Checking the release notes against the merged changes.';
const finishedStart = (label: string) => `Ready for ${label}: the notes list the export fix`;
const finished = (label: string) =>
  `${finishedStart(label)} and the keyboard shortcuts, and the migration note moved to the top.`;
const titleOf = (label: string) => `Release notes for ${label}`;

type Account = MatrixSession & { username: string };
type World = { reader: Account; agent: MatrixSession; peer: Account; roomId: string };

const registerAndLogin = (name: string): Promise<Account> =>
  registerDisposableUser(`tlsg_${name}_${RUN}`, PASSWORD);

const inThread = (rootId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

const seed = async (engine: string): Promise<World & { busyRootId: string }> => {
  const reader = await registerAndLogin(engine);
  const peer = await registerAndLogin(`${engine}_peer`);
  const agent = await registerAgentAccount(HOMESERVER, `notes_${engine}`);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(agent.userId)}/displayname`, {
    method: 'PUT',
    accessToken: agent.accessToken,
    body: JSON.stringify({ displayname: 'Helper' }),
  });
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [agent.userId, peer.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  await joinRoom(HOMESERVER, peer.accessToken, roomId);
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index}` });
  let busyRootId = '';
  for (let index = 1; index <= HISTORY; index += 1) {
    const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Release item ${index}: what is still open before we tag?`,
    });
    await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Release item ${index}: the build passed, the changelog is drafted, and the staging deploy is waiting for the last review.`,
      'io.mindroom.stream_status': 'completed',
      ...inThread(rootId),
    });
    if (index === 1) busyRootId = rootId;
  }
  return { reader, agent, peer, roomId, busyRootId };
};

type SyncGate = {
  /** Keeps the next /sync answer back; resolves once the page's long poll has its answer. */
  hold: () => Promise<void>;
  release: () => void;
  /** Whether a /sync answer after the hold said the room's timeline was limited. */
  sawLimited: (roomId: string) => boolean;
};

const gateSync = async (page: Page): Promise<SyncGate> => {
  let held: { promise: Promise<void>; release: () => void; answered: () => void } | undefined;
  const limitedRooms = new Set<string>();
  await page.route(
    (url) => url.pathname.endsWith('/_matrix/client/v3/sync'),
    async (route) => {
      try {
        // The long poll may take as long as the server's own 30 s timeout.
        const response = await route.fetch({ timeout: 0 });
        const gate = held;
        gate?.answered();
        await gate?.promise;
        const body = (await response.json()) as {
          rooms?: { join?: Record<string, { timeline?: { limited?: boolean } }> };
        };
        Object.entries(body.rooms?.join ?? {}).forEach(([roomId, joined]) => {
          if (joined.timeline?.limited) limitedRooms.add(roomId);
        });
        await route.fulfill({ response });
      } catch {
        // The page closed while the long poll was open.
      }
    }
  );
  return {
    hold: () => {
      let release!: () => void;
      let answered!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      const hasAnswer = new Promise<void>((resolve) => {
        answered = resolve;
      });
      held = { promise, release, answered };
      return hasAnswer;
    },
    release: () => {
      held?.release();
      held = undefined;
    },
    sawLimited: (roomId) => limitedRooms.has(roomId),
  };
};

const sendAgent = (world: World, content: Record<string, unknown>) =>
  sendRoomMessage(HOMESERVER, world.agent.accessToken, world.roomId, content);

const streamEdit = (world: World, replyId: string, body: string, status: string) => {
  const msgtype = status === 'completed' ? 'm.text' : 'm.notice';
  return sendAgent(world, {
    msgtype,
    body: `* ${body}`,
    'io.mindroom.stream_status': status,
    'm.new_content': { msgtype, body, 'io.mindroom.stream_status': status },
    'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
  });
};

const sendTitle = (world: World, rootId: string, title: string) =>
  sendAgent(world, {
    msgtype: 'm.notice',
    body: title,
    'io.mindroom.thread_summary': {
      version: 1,
      summary: title,
      message_count: 2,
      generated_at: new Date().toISOString(),
      model: 'test',
    },
    ...inThread(rootId),
  });

const ask = (world: World, question: string) =>
  sendRoomMessage(HOMESERVER, world.reader.accessToken, world.roomId, {
    msgtype: 'm.text',
    body: question,
  });

const threadCard = (page: Page, rootId: string) =>
  page.locator(`[data-thread-root-id="${rootId}"]`).first();

/** Holds the cache's gap fill (/messages pages of 200 back from a gap) until the page closes. */
const holdGapFill = (page: Page) =>
  page.route(
    (url) =>
      url.pathname.endsWith('/messages') &&
      url.searchParams.get('dir') === 'b' &&
      url.searchParams.get('limit') === '200',
    () => new Promise<void>(() => undefined)
  );

const check = async (
  page: Page,
  world: World & { busyRootId: string },
  label: string,
  quietRoomId: string
) => {
  const sync = await gateSync(page);
  await holdGapFill(page);
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(world.roomId)}/`);
  await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(threadCard(page, world.busyRootId)).toBeAttached({ timeout: 30_000 });

  // A reply that starts before the gap, on a card on screen, which loads its thread.
  const startedLabel = `${label} started`;
  const startedRootId = await ask(world, `Which ${startedLabel} fixes go into the notes?`);
  const loadedThread = page.waitForResponse(
    (response) =>
      response.url().includes(`/relations/${encodeURIComponent(startedRootId)}`) && response.ok(),
    { timeout: 30_000 }
  );
  const startedReplyId = await sendAgent(world, {
    msgtype: 'm.text',
    body: PLACEHOLDER,
    'io.mindroom.stream_status': 'pending',
    ...inThread(startedRootId),
  });
  await streamEdit(world, startedReplyId, FIRST_STEP, 'streaming');
  await expect(threadCard(page, startedRootId)).toContainText(FIRST_STEP, { timeout: 30_000 });
  await loadedThread;

  // The page falls behind: its long poll has an answer it does not take yet.
  const answered = sync.hold();
  await sendRoomMessage(HOMESERVER, world.reader.accessToken, quietRoomId, {
    msgtype: 'm.text',
    body: `Checking in on ${label}.`,
  });
  await answered;

  // The started reply finishes inside the gap, and gets its title.
  await streamEdit(world, startedReplyId, `${FIRST_STEP} Two entries are missing.`, 'streaming');
  await streamEdit(world, startedReplyId, finished(startedLabel), 'completed');
  await sendTitle(world, startedRootId, titleOf(startedLabel));
  // A thread that starts and finishes inside the gap.
  const gapLabel = `${label} gap`;
  const gapRootId = await ask(world, `Is the ${gapLabel} changelog drafted?`);
  const gapReplyId = await sendAgent(world, {
    msgtype: 'm.text',
    body: PLACEHOLDER,
    'io.mindroom.stream_status': 'pending',
    ...inThread(gapRootId),
  });
  await streamEdit(world, gapReplyId, FIRST_STEP, 'streaming');
  await streamEdit(world, gapReplyId, finished(gapLabel), 'completed');
  await sendTitle(world, gapRootId, titleOf(gapLabel));
  // A busy thread pushes all of that out of the next answer's 20 events.
  for (let index = 1; index <= BUSY_REPLIES; index += 1) {
    await sendRoomMessage(HOMESERVER, world.peer.accessToken, world.roomId, {
      msgtype: 'm.text',
      body: `${label} review note ${index}: the staging numbers look right for this part.`,
      ...inThread(world.busyRootId),
    });
  }
  sync.release();

  await expect
    .poll(() => sync.sawLimited(world.roomId), { timeout: 30_000, message: 'a limited sync' })
    .toBe(true);
  for (const [rootId, cardLabel] of [
    [gapRootId, gapLabel],
    [startedRootId, startedLabel],
  ] as const) {
    const card = threadCard(page, rootId);
    await expect(card).toBeAttached({ timeout: 30_000 });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toContainText(titleOf(cardLabel), { timeout: 30_000 });
    await expect(card).toContainText(finishedStart(cardLabel), { timeout: 30_000 });
    await expect(card).not.toHaveAttribute('data-attention-state', 'streaming');
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label.replaceAll(' ', '-')}.png` });
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  const quietRoomId = await createRoom(HOMESERVER, world.reader.accessToken, {
    name: 'Quiet Corner',
  });
  for (const [viewport, options] of [
    ['phone', PHONE],
    ['desktop', DESKTOP],
  ] as const) {
    // WebKit sends a service worker's requests past page.route, so the /sync gate needs it off.
    const context = await browser.newContext({ ...options, baseURL, serviceWorkers: 'block' });
    try {
      const page = await context.newPage();
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: world.reader.username,
        password: PASSWORD,
      });
      await check(page, world, `${engine} ${viewport}`, quietRoomId);
    } finally {
      await context.close();
    }
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('the Compact list catches up on threads a limited sync skipped (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test('the Compact list catches up on threads a limited sync skipped (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
