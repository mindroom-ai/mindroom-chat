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

// An agent streams its reply as one message that `m.replace` edits keep growing; the edit whose
// `io.mindroom.stream_status` is terminal finishes it. A thread card in the room's Compact view
// shows the reply's newest text, so once the stream finishes the card shows the finished text,
// whether the reader read the reply half-way (opened the thread, then went back to the list) or
// never opened the thread. Against the disposable homeserver of a slot (scripts/e2e-slot.sh), on
// a phone (390 by 844, touch) and a desktop (1280 by 800), in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
// The reader opens the thread just after the reply starts, and the page's /sync answers wait until
// the thread has loaded, so the thread's own requests bring the reply before /sync does. A slow
// /sync (a busy page, a phone network) does that; Linux WebKit did it on its own, and its cards
// then kept the reply's first text after the reply finished.
// Set THREAD_CARD_SHOTS=<directory> to save the list once each reply finished.
const PASSWORD = 'thread-card-stream-finish-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.THREAD_CARD_SHOTS;
const ROOM_NAME = 'Release Desk';
const FILLER_ROOMS = 24;
const HISTORY = 30;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

const FIRST_STEP = 'Checking the release notes against the merged changes.';
const SECOND_STEP =
  'Checking the release notes against the merged changes. Two entries are missing: the export fix and the new keyboard shortcuts.';
/** The card shortens a long preview, so tests look for the finished text's start. */
const finishedStart = (label: string) => `Ready for ${label}: the notes list the export fix`;
const finished = (label: string) =>
  `${finishedStart(label)} and the keyboard shortcuts, and the migration note moved to the top, since every operator must act on it before the upgrade.`;

type Account = MatrixSession & { username: string };

const registerAndLogin = (name: string): Promise<Account> =>
  registerDisposableUser(`tcsf_${name}_${RUN}`, PASSWORD);

type World = { reader: Account; agent: MatrixSession; roomId: string };

const seed = async (engine: string): Promise<World> => {
  const reader = await registerAndLogin(engine);
  const agent = await registerAgentAccount(HOMESERVER, `notes_${engine}`);
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
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index}` });
  for (let index = 1; index <= HISTORY; index += 1) {
    const fromAgent = index % 2 === 0;
    await sendRoomMessage(HOMESERVER, (fromAgent ? agent : reader).accessToken, roomId, {
      msgtype: 'm.text',
      body: fromAgent
        ? `Release item ${index}: the build passed, the changelog is drafted, and the staging deploy is waiting for the last review.`
        : `Release item ${index}: what is still open before we tag?`,
      ...(fromAgent ? { 'io.mindroom.stream_status': 'completed' } : {}),
    });
  }
  return { reader, agent, roomId };
};

const inThread = (rootId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

const askQuestion = (world: World, question: string) =>
  sendRoomMessage(HOMESERVER, world.reader.accessToken, world.roomId, {
    msgtype: 'm.text',
    body: question,
  });

/** Starts a reply as MindRoom does: a message marked as streaming. */
const startStream = (world: World, rootId: string) =>
  sendRoomMessage(HOMESERVER, world.agent.accessToken, world.roomId, {
    msgtype: 'm.text',
    body: FIRST_STEP,
    'io.mindroom.stream_status': 'streaming',
    ...inThread(rootId),
  });

const streamEdit = (world: World, replyId: string, body: string, status: string) =>
  sendRoomMessage(HOMESERVER, world.agent.accessToken, world.roomId, {
    msgtype: 'm.text',
    body: `* ${body}`,
    'm.new_content': { msgtype: 'm.text', body, 'io.mindroom.stream_status': status },
    'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
  });

const navigate = async (page: Page, route: string) => {
  await page.evaluate((target) => {
    window.history.pushState(null, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
};

const roomRoute = (roomId: string) => `/home/${encodeURIComponent(roomId)}/`;
const threadRoute = (roomId: string, rootId: string) =>
  `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`;

const threadCard = (page: Page, rootId: string) =>
  page.locator(`[data-thread-root-id="${rootId}"]`).first();

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** Streams the reply's second step, then finishes it. */
const finishStream = async (world: World, replyId: string, label: string) => {
  await streamEdit(world, replyId, SECOND_STEP, 'streaming');
  await streamEdit(world, replyId, finished(label), 'completed');
};

type SyncGate = { hold: () => void; release: () => void };

/** Lets the page's /sync answers through, or keeps them back from `hold` until `release`. */
const gateSync = async (page: Page): Promise<SyncGate> => {
  let held: { promise: Promise<void>; release: () => void } | undefined;
  await page.route(
    (url) => url.pathname.endsWith('/_matrix/client/v3/sync'),
    async (route) => {
      try {
        // The long poll may take as long as the server's own 30 s timeout.
        const response = await route.fetch({ timeout: 0 });
        await held?.promise;
        await route.fulfill({ response });
      } catch {
        // The page closed while the long poll was open.
      }
    }
  );
  return {
    hold: () => {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      held = { promise, release };
    },
    release: () => {
      held?.release();
      held = undefined;
    },
  };
};

/** (a) The reader opens the thread while the reply streams, then goes back to the list. */
const readHalfWay = async (page: Page, sync: SyncGate, world: World, label: string) => {
  const question = `Which ${label} fixes go into the notes?`;
  const rootId = await askQuestion(world, question);
  await expect(page.getByText(question, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  sync.hold();
  const replyId = await startStream(world, rootId);
  await navigate(page, threadRoute(world.roomId, rootId));
  await expect(page.getByText(FIRST_STEP, { exact: true }).last()).toBeVisible({
    timeout: 30_000,
  });
  sync.release();
  await navigate(page, roomRoute(world.roomId));
  await expect(threadCard(page, rootId)).toContainText(FIRST_STEP, { timeout: 30_000 });

  await finishStream(world, replyId, label);
  await expect(threadCard(page, rootId)).toContainText(finishedStart(label), {
    timeout: 30_000,
  });
  await shot(page, `${label}-half-way`);
};

/** (b) The reply streams and finishes while its card is on the list; the thread stays closed. */
const neverOpened = async (page: Page, world: World, label: string) => {
  const rootId = await askQuestion(world, `Who reviews the ${label} notes?`);
  const replyId = await startStream(world, rootId);
  await expect(threadCard(page, rootId)).toContainText(FIRST_STEP, { timeout: 30_000 });

  await finishStream(world, replyId, label);
  await expect(threadCard(page, rootId)).toContainText(finishedStart(label), {
    timeout: 30_000,
  });
  await shot(page, `${label}-never-opened`);
};

const check = async (page: Page, world: World, label: string) => {
  const sync = await gateSync(page);
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(roomRoute(world.roomId));
  await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
    timeout: 60_000,
  });
  await readHalfWay(page, sync, world, `${label} half-way`);
  await neverOpened(page, world, `${label} closed`);
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
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
      await check(page, world, `${engine} ${viewport}`);
    } finally {
      await context.close();
    }
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a thread card shows a streamed reply once it finishes (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test('a thread card shows a streamed reply once it finishes (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
