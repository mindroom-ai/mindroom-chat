import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  createHiddenOverviewFilterState,
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
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// A reader of a busy room reloads. The room has 340 threads; the newest 40 are agent replies that
// the room's thread list was read for while they were placeholders, so the page saved their roots
// with that summary. 30 of them finish while the reader watches (the page saves the finished
// replies and their titles with the threads' events); 10 finish while the page is away, behind a
// gap deeper than one /sync answer. After each reload, with the server's thread list and events
// slow:
// - the room's thread list pages to its end, each page once (a busy room's list used to stop,
//   keeping old summaries for good),
// - no finished reply's card streams, not even for a moment,
// - the page asks the server about none of those replies one by one (it asked once per thread):
//   the cache answers for the 30, the thread list for the 10.
// Against the disposable homeserver of a slot, desktop 1280 by 800, Chromium and (with
// PLAYWRIGHT_WEBKIT_EXECUTABLE) WebKit. Set THREAD_CACHE_SHOTS=<directory> to save screenshots.
const PASSWORD = 'thread-cache-reload-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.THREAD_CACHE_SHOTS;
const PHONE = process.env.CARD_PREVIEW_PHONE === '1';
const THEME = process.env.CARD_PREVIEW_THEME ?? 'light';
const ROOM_NAME = 'Release Desk';
const FILLER_ROOMS = 25;
const HISTORY = 300;
const STREAMS = 40;
/** Replies that finish while the reader watches; the others finish while the page is away. */
const LIVE_FINISHES = 30;
const THREADS = HISTORY + STREAMS;
const AGENT_NAMES = ['Planner', 'Reviewer', 'Tester', 'Writer'];
/** More events than one /sync answer carries for a room (20). */
const BUSY_REPLIES = 30;
/** How long each /threads page and each single event takes after the reloads. */
const SLOW_MS = 1_500;

const PLACEHOLDER = 'Thinking...';
const stepText = (index: number) =>
  `Item ${index}: checking the release notes against the merged changes.`;
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
  busyRootId: string;
};

const registerAndLogin = async (name: string): Promise<Account> => {
  const username = `tcr_${name}_${RUN}`;
  await matrixFetch(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
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

const agentFor = (agents: MatrixSession[], index: number): MatrixSession => {
  const agent = agents[index % agents.length];
  if (!agent) throw new Error('The room has no agents');
  return agent;
};

/** Runs `count` jobs, `width` at a time. */
const inBatches = async (
  count: number,
  width: number,
  job: (index: number) => Promise<unknown>
) => {
  for (let start = 0; start < count; start += width)
    await Promise.all(
      Array.from({ length: Math.min(width, count - start) }, (_, offset) => job(start + offset))
    );
};

const seed = async (engine: string): Promise<World> => {
  const reader = await registerAndLogin(engine);
  const peer = await registerAndLogin(`${engine}_peer`);
  const agents: MatrixSession[] = [];
  for (const name of AGENT_NAMES) {
    const agent = await registerAgentAccount(HOMESERVER, `${name.toLowerCase()}_${engine}_${RUN}`);
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
  await inBatches(FILLER_ROOMS, 5, (index) =>
    createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1}` })
  );
  const world: World = { reader, peer, agents, roomId, busyRootId: '' };
  // Older finished threads: a question, the agent's finished answer and its title.
  await inBatches(HISTORY, 25, async (index) => {
    const agent = agentFor(agents, index);
    const rootId = await send(world, index % 3 === 0 ? peer : reader, {
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
    if (index === 0) world.busyRootId = rootId;
  });
  return world;
};

const threadCard = (page: Page, rootId: string) =>
  page.locator(`[data-compact-room-view] [data-thread-root-id="${rootId}"]`).first();

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

const ofStreams = (rootIds: string[], streams: Stream[]) => {
  const ours = new Set(streams.map((stream) => stream.rootId));
  return [...new Set(rootIds)].filter((rootId) => ours.has(rootId));
};

const openRoom = async (page: Page, world: World) => {
  await page.goto(`/home/${encodeURIComponent(world.roomId)}/`);
  await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
    timeout: 60_000,
  });
};

type ListEnds = { count: number };

/**
 * Counts the room's thread list pages that end the list (no `next_batch`). The count chip is no
 * proxy: in the Compact view it also waits for the room's history to reach its start.
 */
const watchListEnds = (page: Page, world: World): ListEnds => {
  const ends: ListEnds = { count: 0 };
  page.on('response', (response) => {
    const url = new URL(response.url());
    const path = decodeURIComponent(url.pathname);
    if (!path.endsWith(`/rooms/${world.roomId}/threads`) || !response.ok()) return;
    if (url.searchParams.get('include') !== 'all') return;
    response
      .json()
      .then((body: { next_batch?: string }) => {
        if (!body.next_batch) ends.count += 1;
      })
      .catch(() => undefined);
  });
  return ends;
};

/** Waits until the room's thread list is read to its end once more. */
const expectWholeList = async (ends: ListEnds, before: number, label: string) => {
  await expect
    .poll(() => ends.count > before, {
      timeout: 120_000,
      message: `${label}: the room's thread list read to its end`,
    })
    .toBe(true);
};

/** Each finished reply's card stops streaming. */
const expectNoneStreaming = async (page: Page, streams: Stream[], label: string) => {
  let stuck = ofStreams(await streamingNow(page), streams);
  for (let waited = 0; stuck.length > 0 && waited < 30_000; waited += 500) {
    await page.waitForTimeout(500);
    stuck = ofStreams(await streamingNow(page), streams);
  }
  expect.soft(stuck, `${label}: finished replies whose card streams`).toEqual([]);
};

type Watch = {
  holdLists: () => () => void;
  /** The page's single-event requests for the agents' replies. */
  replyRequests: string[];
  /** The room's /threads requests (`include` and `from`). */
  listRequests: string[];
};

/** Counts the requests that matter, and makes /threads pages and single events slow. */
const watchRequests = async (page: Page, world: World, replyIds: Set<string>): Promise<Watch> => {
  let listGate: Promise<void> | undefined;
  const watch: Watch = {
    replyRequests: [],
    listRequests: [],
    holdLists: () => {
      let release!: () => void;
      listGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        listGate = undefined;
        release();
      };
    },
  };
  const roomPath = `/rooms/${world.roomId}/`;
  page.on('request', (request) => {
    const url = new URL(request.url());
    const path = decodeURIComponent(url.pathname);
    if (!path.includes(roomPath)) return;
    const eventId = path.match(/\/event\/([^/]+)$/)?.[1];
    if (eventId && replyIds.has(eventId)) watch.replyRequests.push(eventId);
    if (path.endsWith('/threads'))
      watch.listRequests.push(
        `${url.searchParams.get('include')}:${url.searchParams.get('from') ?? 'start'}`
      );
  });
  await page.route(
    (url) => {
      const path = decodeURIComponent(url.pathname);
      return (
        path.includes(roomPath) &&
        (path.endsWith('/threads') || path.includes('/relations/') || /\/event\/[^/]+$/.test(path))
      );
    },
    async (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname);
      if (path.endsWith('/threads') || path.includes('/relations/')) await listGate;
      await new Promise((resolve) => {
        setTimeout(resolve, SLOW_MS);
      });
      await route.continue().catch(() => undefined);
    }
  );
  return watch;
};

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const report = (description: string) => {
  test.info().annotations.push({ type: 'thread cache', description });
  // eslint-disable-next-line no-console
  console.log(`thread cache: ${description}`);
};

const check = async (page: Page, world: World, engine: string) => {
  await page.addInitScript(recordStreamingCards);
  const listEnds = watchListEnds(page, world);
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'compact',
    filterState: createHiddenOverviewFilterState(),
  });
  await openRoom(page, world);

  // Every agent starts replies in 40 new threads.
  const streams: Stream[] = [];
  await inBatches(STREAMS, 10, async (offset) => {
    const index = offset + 1;
    const agent = agentFor(world.agents, index);
    // Other people's questions: the reader's sidebar lists only the reader's own threads.
    const rootId = await send(world, world.peer, {
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
  });
  streams.sort((a, b) => a.index - b.index);

  // The reader reloads before the first words: the room's thread list is read while every reply
  // is its placeholder, and the page saves the roots with that summary.
  const endsBeforeReload = listEnds.count;
  await page.reload();
  await openRoom(page, world);
  await expectWholeList(listEnds, endsBeforeReload, `${engine} first read`);
  await inBatches(STREAMS, 10, async (offset) => {
    const stream = streams[offset];
    if (stream) await streamEdit(world, stream, stepText(stream.index), 'streaming');
  });

  // 30 replies finish while the reader watches, each with its title.
  const live = streams.slice(0, LIVE_FINISHES);
  const away = streams.slice(LIVE_FINISHES);
  for (const stream of live) {
    await streamEdit(world, stream, finishedText(stream.index), 'completed');
    await sendTitle(world, stream.agent, stream.rootId, titleText(stream.index));
  }
  await expectNoneStreaming(page, live, `${engine} watched`);
  // The page saves what it received a moment later.
  await page.waitForTimeout(3_000);
  for (const stream of live.slice(0, 4)) {
    await expect
      .soft(threadCard(page, stream.rootId), `${engine}: off-screen terminal edit ${stream.index}`)
      .toContainText(`Item ${stream.index} is ready: the notes list the export fix`);
  }

  // The others finish while the page is away, and a busy thread pushes their last edits out of
  // the room's next /sync answer; half of them get a title.
  await page.goto('about:blank');
  for (const [position, stream] of away.entries()) {
    await streamEdit(world, stream, finishedText(stream.index), 'completed');
    if (position % 2 === 0)
      await sendTitle(world, stream.agent, stream.rootId, titleText(stream.index));
  }
  for (let note = 1; note <= BUSY_REPLIES; note += 1)
    await send(world, world.peer, {
      msgtype: 'm.text',
      body: `Release note ${note}: the staging numbers look right for this part.`,
      ...inThread(world.busyRootId),
    });

  // Two reloads, with the server's thread list and single events slow.
  const watch = await watchRequests(page, world, new Set(streams.map((s) => s.replyId)));
  for (const pass of ['first', 'second']) {
    const before = {
      replies: watch.replyRequests.length,
      lists: watch.listRequests.length,
      ends: listEnds.count,
    };
    const releaseLists = watch.holdLists();
    try {
      await openRoom(page, world);
      for (const stream of streams.slice(0, 8))
        await expect(threadCard(page, stream.rootId)).toBeAttached({ timeout: 60_000 });
      await page.waitForTimeout(2_000);
      await shot(page, `${engine}-reload-${pass}`);
      // These older cards stayed outside the viewport while the replies finished. A title notice
      // is the thread's newest event, so only the card's cached reply preview can show the answer.
      // Check the actual text on the first scroll into view, before opening any thread.
      for (const stream of live.slice(0, 4)) {
        const card = threadCard(page, stream.rootId);
        await expect
          .soft(card, `${engine} ${pass}: finished reply preview ${stream.index}`)
          .toContainText(`Item ${stream.index} is ready: the notes list the export fix`, {
            timeout: 10_000,
          });
        await card.scrollIntoViewIfNeeded();
        await shot(
          page,
          `${engine}-${PHONE ? 'phone' : 'desktop'}-${THEME}-${pass}-${stream.index}`
        );
      }
    } finally {
      releaseLists();
    }
    await expectWholeList(listEnds, before.ends, `${engine} ${pass} reload`);
    await expectNoneStreaming(page, streams, `${engine} ${pass} reload`);
    await page.waitForTimeout(3_000);
    const asked = watch.replyRequests.slice(before.replies);
    const lists = watch.listRequests.slice(before.lists);
    report(
      `${engine} ${pass} reload: ${asked.length} single requests for the ${STREAMS} replies, ${lists.length} /threads requests`
    );
    expect.soft(asked, `${engine} ${pass}: replies asked about one by one`).toEqual([]);
    // Each page of the room's list once: every page, and no page twice.
    const roomPages = lists.filter((request) => request.startsWith('all:'));
    const pages = Math.ceil(THREADS / 30);
    expect.soft(new Set(roomPages).size, `${engine} ${pass}: room list pages`).toBe(pages);
    expect.soft(roomPages.length, `${engine} ${pass}: room list requests`).toBe(pages);
  }
  expect
    .soft(ofStreams(await streamingSince(page), streams), `${engine}: ever streaming`)
    .toEqual([]);
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  // WebKit sends a service worker's requests past page.route, so the routes need it off.
  const context = await browser.newContext({
    viewport: PHONE ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    hasTouch: PHONE,
    baseURL,
    serviceWorkers: 'block',
  });
  try {
    const page = await context.newPage();
    await page.addInitScript((theme) => {
      const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as Record<
        string,
        unknown
      >;
      localStorage.setItem(
        'settings',
        JSON.stringify({ ...settings, useSystemTheme: false, themeId: `${theme}-theme` })
      );
    }, THEME);
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    await check(page, world, engine);
  } finally {
    await context.close();
  }
};

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a reload of a busy room restores finished threads without asking for each (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(600_000);
  await run(browser, baseURL, 'chromium');
});

test('a reload of a busy room restores finished threads without asking for each (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(600_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
