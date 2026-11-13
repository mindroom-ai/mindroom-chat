import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  createDefaultThreadFilterState,
  joinRoom,
  loginToMatrix,
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
} from '../helpers/disposableAccounts';

// Agents stream their replies as one message that `m.replace` edits keep growing; the edit whose
// `io.mindroom.stream_status` is terminal finishes it, and the thread's title notice follows. Once
// that edit is on the server, no card of the room's Compact view may say "streaming" (nor list its
// thread in the Working preset): whether the reader saw the edit live, missed it in a sync gap, or
// reloaded after it, and never, not even for a moment, from what the page kept from before a
// reload. Several agents stream in many threads of one busy room at once, most cards off screen;
// the reader reloads while they stream (so the room's thread list is read mid-stream), the page
// falls behind while they finish (a gap deeper than one /sync answer), and the server's thread
// list is slow after the last reload, as in a room with hundreds of threads. Against the
// disposable homeserver of a slot (scripts/e2e-slot.sh), on a desktop (1280 by 800), in Chromium
// and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set
// STUCK_STREAMING_SHOTS=<directory> to save the list at each check.
const PASSWORD = 'stuck-streaming-cards-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.STUCK_STREAMING_SHOTS;
const ROOM_NAME = 'Load Desk';
const FILLER_ROOMS = 25;
const HISTORY = 30;
const AGENT_NAMES = ['Planner', 'Reviewer', 'Tester', 'Writer'];
const STREAMS = 24;
/** Replies that finish while the reader follows live; the others finish in a gap. */
const LIVE_FINISHES = 8;
/** More events than one /sync answer carries for a room (20), so a gap hides what came before. */
const BUSY_REPLIES = 30;
/** How long the server's thread list takes after the last reload. */
const SLOW_LIST_MS = 12_000;

const PLACEHOLDER = 'Thinking...';
const WORDS = [
  'Checking the release notes against the merged changes.',
  'Two entries are missing: the export fix and the new keyboard shortcuts.',
  'The migration note belongs at the top, since every operator must act on it.',
  'The staging numbers match the benchmark run from this morning.',
];
const stepText = (index: number, step: number) =>
  `Item ${index}: ${WORDS.slice(0, step).join(' ')}`;
const finishedText = (index: number) =>
  `Item ${index} is ready: the notes list the export fix and the keyboard shortcuts, and the migration note moved to the top.`;
const titleText = (index: number) => `Release notes item ${index}`;

type Account = MatrixSession & { username: string };
type Stream = { index: number; rootId: string; replyId: string; agent: MatrixSession };
type World = {
  reader: Account;
  peer: Account;
  agents: MatrixSession[];
  roomId: string;
  historyRootId: string;
};

const registerAndLogin = async (name: string): Promise<Account> => {
  const username = `ssc_${name}_${RUN}`;
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

const inThread = (rootId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

const send = (world: World, sender: MatrixSession, content: Record<string, unknown>) =>
  sendRoomMessage(HOMESERVER, sender.accessToken, world.roomId, content);

const streamEdit = (world: World, stream: Stream, body: string, status: string) =>
  send(world, stream.agent, {
    msgtype: 'm.text',
    body: `* ${body}`,
    'io.mindroom.stream_status': status,
    'm.new_content': { msgtype: 'm.text', body, 'io.mindroom.stream_status': status },
    'm.relates_to': { rel_type: 'm.replace', event_id: stream.replyId },
  });

const finish = (world: World, stream: Stream) =>
  streamEdit(world, stream, finishedText(stream.index), 'completed');

const sendTitle = (world: World, sender: MatrixSession, rootId: string, title: string) =>
  send(world, sender, {
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

/** A person's conversation in an older thread: enough events to push others out of a /sync answer. */
const busyThread = async (world: World, label: string) => {
  for (let index = 1; index <= BUSY_REPLIES; index += 1)
    await send(world, world.peer, {
      msgtype: 'm.text',
      body: `${label} note ${index}: the staging numbers look right for this part of the release.`,
      ...inThread(world.historyRootId),
    });
};

/** The agent that answers item `index`: the agents take turns. */
const agentFor = (agents: MatrixSession[], index: number): MatrixSession => {
  const agent = agents[index % agents.length];
  if (!agent) throw new Error('The room has no agents');
  return agent;
};

const seed = async (engine: string): Promise<World> => {
  const reader = await registerAndLogin(engine);
  const peer = await registerAndLogin(`${engine}_peer`);
  const agents: MatrixSession[] = [];
  for (const name of AGENT_NAMES) {
    const agent = await registerAgentAccount(HOMESERVER, `${name.toLowerCase()}_${engine}`);
    await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(agent.userId)}/displayname`, {
      method: 'PUT',
      accessToken: agent.accessToken,
      body: JSON.stringify({ displayname: name }),
    });
    agents.push(agent);
  }
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [peer.userId, ...agents.map((agent) => agent.userId)],
  });
  await joinRoom(HOMESERVER, peer.accessToken, roomId);
  for (const agent of agents) await joinRoom(HOMESERVER, agent.accessToken, roomId);
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index}` });
  const world: World = { reader, peer, agents, roomId, historyRootId: '' };
  for (let index = 1; index <= HISTORY; index += 1) {
    const agent = agentFor(agents, index);
    const rootId = await send(world, reader, {
      msgtype: 'm.text',
      body: `Earlier item ${index}: what is still open before we tag the release?`,
    });
    await send(world, agent, {
      msgtype: 'm.text',
      body: `Earlier item ${index}: the build passed, the changelog is drafted, and the staging deploy waits for the last review.`,
      'io.mindroom.stream_status': 'completed',
      ...inThread(rootId),
    });
    await sendTitle(world, agent, rootId, `Earlier release item ${index}`);
    if (index === 1) world.historyRootId = rootId;
  }
  return world;
};

const threadCard = (page: Page, rootId: string) =>
  page.locator(`[data-thread-root-id="${rootId}"]`).first();

/** Records in the page every thread whose card says it streams, from the page's start on. */
const recordStreamingCards = () => {
  const seen = new Set<string>();
  (window as unknown as { __streamingCards: Set<string> }).__streamingCards = seen;
  const note = (element: Element) => {
    if (element.getAttribute('data-attention-state') !== 'streaming') return;
    const rootId = element.getAttribute('data-thread-root-id');
    if (rootId) seen.add(rootId);
  };
  new MutationObserver((records) => {
    records.forEach((record) => {
      if (record.type === 'attributes' && record.target instanceof Element) note(record.target);
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        note(node);
        node.querySelectorAll('[data-attention-state]').forEach(note);
      });
    });
  }).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-attention-state'],
  });
};

const streamingSince = (page: Page): Promise<string[]> =>
  page.evaluate(() => [
    ...(window as unknown as { __streamingCards: Set<string> }).__streamingCards,
  ]);

const streamingNow = (page: Page): Promise<string[]> =>
  page
    .locator('[data-attention-state="streaming"]')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-thread-root-id') ?? ''));

const finishedOnly = (rootIds: string[], streams: Stream[]) => {
  const finished = new Set(streams.map((stream) => stream.rootId));
  return rootIds.filter((rootId) => finished.has(rootId));
};

const openRoom = async (page: Page, world: World) => {
  await page.goto(`/home/${encodeURIComponent(world.roomId)}/`);
  await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(threadCard(page, world.historyRootId)).toBeAttached({ timeout: 60_000 });
};

/** Each finished reply has its card, and within a while none of them says it streams. */
const expectFinished = async (page: Page, streams: Stream[], label: string) => {
  for (const stream of streams)
    await expect(threadCard(page, stream.rootId), `${label}: card ${stream.index}`).toBeAttached({
      timeout: 60_000,
    });
  // Soft, so one run shows every check that fails.
  let stuck = finishedOnly(await streamingNow(page), streams);
  for (let waited = 0; stuck.length > 0 && waited < 30_000; waited += 500) {
    await page.waitForTimeout(500);
    stuck = finishedOnly(await streamingNow(page), streams);
  }
  expect.soft(stuck, `${label}: finished replies whose card streams`).toEqual([]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label.replaceAll(' ', '-')}.png` });
};

type SyncGate = {
  /** Keeps the next /sync answer back; resolves once the page's long poll has its answer. */
  hold: () => Promise<void>;
  /** Lets the answers through; resolves once one after the hold says the room was limited. */
  release: () => Promise<void>;
};

/** The page falls behind: its long poll has an answer that it takes only on release. */
const gateSync = async (page: Page, roomId: string): Promise<SyncGate> => {
  let held: { promise: Promise<void>; release: () => void; answered: () => void } | undefined;
  let limited = 0;
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
        if (body.rooms?.join?.[roomId]?.timeline?.limited) limited += 1;
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
    release: async () => {
      const before = limited;
      held?.release();
      held = undefined;
      await expect
        .poll(() => limited > before, { timeout: 60_000, message: 'a limited /sync answer' })
        .toBe(true);
    },
  };
};

/** Nudges the page's long poll with a message in another room, so a hold catches an answer. */
const nudge = (world: World, quietRoomId: string) =>
  sendRoomMessage(HOMESERVER, world.reader.accessToken, quietRoomId, {
    msgtype: 'm.text',
    body: 'Checking in.',
  });

/** Holds the server's thread list (`/threads`) back for `ms`, as in a room with many threads. */
const slowThreadList = (page: Page, ms: number) =>
  page.route(
    (url) => url.pathname.endsWith('/threads'),
    async (route) => {
      await new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
      await route.continue().catch(() => undefined);
    }
  );

const check = async (page: Page, world: World, engine: string, quietRoomId: string) => {
  const sync = await gateSync(page, world.roomId);
  await page.addInitScript(recordStreamingCards);
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await openRoom(page, world);

  // The reader watches the room while every agent starts replies in many threads.
  const streams: Stream[] = [];
  for (let index = 1; index <= STREAMS; index += 1) {
    const agent = agentFor(world.agents, index);
    const rootId = await send(world, world.reader, {
      msgtype: 'm.text',
      body: `Item ${index}: which fixes go into the release notes, and what is still missing?`,
    });
    const replyId = await send(world, agent, {
      msgtype: 'm.text',
      body: PLACEHOLDER,
      'io.mindroom.stream_status': 'pending',
      ...inThread(rootId),
    });
    streams.push({ index, rootId, replyId, agent });
  }
  for (const stream of streams)
    await expect(threadCard(page, stream.rootId)).toBeAttached({ timeout: 60_000 });

  // The reader reloads before the first words: the room's thread list is read while every reply
  // is still its placeholder.
  await page.reload();
  await openRoom(page, world);
  for (const stream of streams)
    await expect(threadCard(page, stream.rootId)).toBeAttached({ timeout: 60_000 });
  for (const step of [1, 2])
    for (const stream of streams)
      await streamEdit(world, stream, stepText(stream.index, step), 'streaming');

  // Some replies finish while the reader follows, each with its title.
  const followed = streams.slice(0, LIVE_FINISHES);
  for (const stream of followed) {
    await finish(world, stream);
    await sendTitle(world, stream.agent, stream.rootId, titleText(stream.index));
  }
  await expectFinished(page, followed, `${engine} finished live`);

  // The others finish while the page has fallen behind, and a busy thread pushes their finishing
  // edits out of the next /sync answer. The backend writes a title only after the reply is
  // delivered, so half of them get theirs after the gap; a thread with a title already gets none.
  const behind = streams.slice(LIVE_FINISHES);
  const answered = sync.hold();
  await nudge(world, quietRoomId);
  await answered;
  for (const stream of behind) {
    await streamEdit(world, stream, stepText(stream.index, 3), 'streaming');
    await finish(world, stream);
  }
  await busyThread(world, `${engine} gap`);
  await sync.release();
  for (const stream of behind.slice(0, behind.length / 2))
    await sendTitle(world, stream.agent, stream.rootId, titleText(stream.index));
  await expectFinished(page, streams, `${engine} after the gap`);

  // The room moves on, and the reader reloads once more. The server's thread list is slow, as in
  // a room with hundreds of threads: what the page kept must not make a finished reply stream.
  await busyThread(world, `${engine} later`);
  await slowThreadList(page, SLOW_LIST_MS);
  await page.reload();
  await openRoom(page, world);
  for (const stream of streams)
    await expect(threadCard(page, stream.rootId)).toBeAttached({ timeout: 60_000 });
  expect
    .soft(finishedOnly(await streamingSince(page), streams), 'streaming as the list loads')
    .toEqual([]);
  await expectFinished(page, streams, `${engine} after the reload`);
  expect
    .soft(finishedOnly(await streamingSince(page), streams), 'streaming after the list loaded')
    .toEqual([]);
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  const quietRoomId = await createRoom(HOMESERVER, world.reader.accessToken, {
    name: 'Quiet Corner',
  });
  // WebKit sends a service worker's requests past page.route, so the gates need it off.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    baseURL,
    serviceWorkers: 'block',
  });
  try {
    const page = await context.newPage();
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    await check(page, world, engine, quietRoomId);
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('finished replies leave no card streaming, through gaps and reloads (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(420_000);
  await run(browser, baseURL, 'chromium');
});

test('finished replies leave no card streaming, through gaps and reloads (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(420_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
