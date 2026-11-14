import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { BrowserContext, expect, Page, test } from '@playwright/test';
import { buildLoginPath, getHomeserver } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  createDefaultThreadFilterState,
  createPrivateRoom,
  createPrivateSpace,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
} from '../helpers/matrix';
import { CHROMIUM_WITH_SCROLLBARS } from '../helpers/disposableAccounts';

/**
 * How fast the client feels with a realistic account, measured in the production build
 * (`e2e-slot.sh --preview`) against the slot's Tuwunel. Opt in with PERF_CLIENT_SPEED=1.
 *
 * The account has 4 spaces of 10 rooms and 6 rooms of its own: 3 large rooms of about 2,300
 * events each (70 threads with an agent's formatted replies, some edited, one thread of 400
 * replies, 6 probe threads of 24 replies seeded last, which the thread test opens, and
 * top-level chatter) and 43 rooms of 30 messages. Each measurement runs
 * PERF_RUNS times (default 5); the medians, quartiles and extremes go to
 * test-results/perf/<name>.json and to the console (`PERF {...}` lines).
 *
 * Times come from the page: an interaction starts at its pointerdown or keydown event's
 * timestamp, a load at the navigation's time origin, and ends at the first animation frame in
 * which the expected element is laid out, visible and inside the viewport (that frame paints it).
 */

const enabled = process.env.PERF_CLIENT_SPEED === '1';
const RUNS = Number(process.env.PERF_RUNS ?? 5);
const CPU_THROTTLE = Number(process.env.PERF_CPU_THROTTLE ?? 1);
const OUT_DIR = 'test-results/perf';
const MANIFEST = `${OUT_DIR}/manifest.json`;
const PASSWORD = 'perf-client-speed-1';
const BIG_ROOMS = 3;
const BIG_THREADS = 70;
const LONG_THREAD_REPLIES = 400;
const PROBE_THREADS = 6;
const PROBE_REPLIES = 24;
const SPACES = 4;
const ROOMS_PER_SPACE = 10;
const HOME_SMALL_ROOMS = 3;
const SMALL_ROOM_MESSAGES = 30;

type RoomFixture = {
  roomId: string;
  name: string;
  /** The newest thread root and its newest reply: what an open room shows first. */
  lastRootId: string;
  lastReplyId: string;
  threads: { rootId: string; lastReplyId: string; replies: number }[];
  /** Threads of the same size seeded last, newest first: what the thread-open test opens. */
  probes: { rootId: string; lastReplyId: string; replies: number }[];
  events: number;
};
type Manifest = {
  homeserver: string;
  username: string;
  userId: string;
  bigRooms: RoomFixture[];
  homeSmallRooms: RoomFixture[];
  spaces: { spaceId: string; rooms: RoomFixture[] }[];
  longThread: { roomId: string; rootId: string; lastReplyId: string; firstReplyId: string };
  totalEvents: number;
  seedSeconds: number;
};

// Deterministic text of realistic lengths: a user's questions and an agent's formatted answers.
const WORDS = (
  'the a deploy build branch cache config review merge check schedule server thread room ' +
  'message agent tool result error retry network latency timeout model token summary draft ' +
  'release notes migration backup database index query report chart metric alert queue worker ' +
  'session account device key sync filter search budget invoice meeting calendar travel plan ' +
  'please could you look into why this changed after yesterday and what we should do next'
).split(' ');
let seed = 1;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
/** The list's item at `index`, which the caller knows is there. */
const item = <T>(list: readonly T[], index: number): T => {
  const value = list[index];
  if (value === undefined) throw new Error(`No item at ${index} of ${list.length}`);
  return value;
};
const pick = <T>(list: T[]) => item(list, Math.floor(random() * list.length));
const sentence = (min: number, max: number) => {
  const length = min + Math.floor(random() * (max - min));
  const words = Array.from({ length }, () => pick(WORDS));
  return `${words.join(' ').replace(/^./, (first) => first.toUpperCase())}.`;
};
const paragraph = (sentences: number) =>
  Array.from({ length: sentences }, () => sentence(6, 18)).join(' ');
const userText = () => ({ msgtype: 'm.text', body: paragraph(1 + Math.floor(random() * 3)) });
const agentText = () => {
  const blocks: { body: string; html: string }[] = [];
  const count = 1 + Math.floor(random() * 4);
  for (let index = 0; index < count; index += 1) {
    const kind = random();
    if (kind < 0.55) {
      const text = paragraph(2 + Math.floor(random() * 4));
      blocks.push({ body: text, html: `<p>${text}</p>` });
    } else if (kind < 0.8) {
      const items = Array.from({ length: 3 + Math.floor(random() * 4) }, () => sentence(4, 12));
      blocks.push({
        body: items.map((item) => `- ${item}`).join('\n'),
        html: `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`,
      });
    } else if (kind < 0.92) {
      const lines = Array.from(
        { length: 4 + Math.floor(random() * 10) },
        (_, line) => `const step${line} = await run("${pick(WORDS)}", { retries: ${line % 4} });`
      );
      blocks.push({
        body: `\`\`\`ts\n${lines.join('\n')}\n\`\`\``,
        html: `<pre><code class="language-ts">${lines.join('\n')}</code></pre>`,
      });
    } else {
      const text = sentence(5, 10);
      blocks.push({
        body: `${text} https://example.org/docs/${pick(WORDS)}`,
        html: `<p>${text} <a href="https://example.org/docs/${pick(WORDS)}">docs</a> and <code>${pick(
          WORDS
        )}</code></p>`,
      });
    }
  }
  return {
    msgtype: 'm.text',
    body: blocks.map((block) => block.body).join('\n\n'),
    format: 'org.matrix.custom.html',
    formatted_body: blocks.map((block) => block.html).join(''),
  };
};

const homeserver = getHomeserver();
let sent = 0;
/** Events sent to each room; rooms are seeded side by side, so `sent` alone cannot tell them apart. */
const sentTo = new Map<string, number>();
const send = async (
  token: string,
  roomId: string,
  content: Record<string, unknown>,
  type = 'm.room.message'
): Promise<string> => {
  sent += 1;
  sentTo.set(roomId, (sentTo.get(roomId) ?? 0) + 1);
  const { event_id: eventId } = await matrixFetch<{ event_id: string }>(
    homeserver,
    `/rooms/${encodeURIComponent(roomId)}/send/${type}/${randomUUID()}`,
    { method: 'PUT', accessToken: token, body: JSON.stringify(content) }
  );
  return eventId;
};
const inThread = (rootId: string, previousId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: previousId },
  },
});
/** Runs the tasks with at most `limit` at once. */
const pool = async <T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> => {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < tasks.length) {
        const index = next;
        next += 1;
        // eslint-disable-next-line no-await-in-loop
        results[index] = await item(tasks, index)();
      }
    })
  );
  return results;
};

type Tokens = { user: string; agent: string };
const seedThread = async (
  tokens: Tokens,
  roomId: string,
  replies: number
): Promise<{ rootId: string; lastReplyId: string; firstReplyId: string; replies: number }> => {
  const rootId = await send(tokens.user, roomId, userText());
  let previous = rootId;
  let firstReplyId = '';
  for (let reply = 0; reply < replies; reply += 1) {
    const fromAgent = reply % 4 !== 3;
    // eslint-disable-next-line no-await-in-loop
    const replyId = await send(fromAgent ? tokens.agent : tokens.user, roomId, {
      ...(fromAgent ? agentText() : userText()),
      ...inThread(rootId, previous),
    });
    firstReplyId ||= replyId;
    // Agents stream their answers as edits; the last edit stays.
    if (fromAgent && random() < 0.3) {
      const content = agentText();
      // eslint-disable-next-line no-await-in-loop
      await send(tokens.agent, roomId, {
        ...content,
        body: `* ${content.body}`,
        'm.new_content': content,
        'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
      });
    }
    previous = replyId;
  }
  return { rootId, lastReplyId: previous, firstReplyId, replies };
};

const createRoom = async (tokens: Tokens, agentId: string, name: string) => {
  const roomId = await createPrivateRoom(homeserver, tokens.user, {
    name,
    topic: `${name}: work with the agent`,
    invite: [agentId],
  });
  await joinRoom(homeserver, tokens.agent, roomId);
  return roomId;
};

const seedBigRoom = async (
  tokens: Tokens,
  agentId: string,
  name: string,
  withLongThread: boolean
): Promise<{ room: RoomFixture; long?: Manifest['longThread'] }> => {
  const roomId = await createRoom(tokens, agentId, name);
  // Top-level chatter first, then the threads, so the threads are the newest activity.
  await pool(
    Array.from({ length: 150 }, () => () => send(tokens.user, roomId, userText())),
    8
  );
  const lengths = Array.from({ length: BIG_THREADS }, (_, index) =>
    withLongThread && index === 0 ? LONG_THREAD_REPLIES : 5 + Math.floor(random() * 40)
  );
  const threads = await pool(
    lengths.map((replies) => () => seedThread(tokens, roomId, replies)),
    12
  );
  // Threads of one size, serially, so every job opens the same kind of thread; then one more
  // exchange, so the newest thread and its newest reply are known.
  const probes = [];
  for (let index = 0; index < PROBE_THREADS; index += 1)
    // eslint-disable-next-line no-await-in-loop
    probes.push(await seedThread(tokens, roomId, PROBE_REPLIES));
  threads.push(...probes);
  const last = await seedThread(tokens, roomId, 2);
  threads.push(last);
  const long = withLongThread
    ? {
        roomId,
        rootId: item(threads, 0).rootId,
        lastReplyId: item(threads, 0).lastReplyId,
        firstReplyId: item(threads, 0).firstReplyId,
      }
    : undefined;
  return {
    room: {
      roomId,
      name,
      lastRootId: last.rootId,
      lastReplyId: last.lastReplyId,
      threads: threads.map(({ rootId, lastReplyId, replies }) => ({ rootId, lastReplyId, replies })),
      probes: probes
        .reverse()
        .map(({ rootId, lastReplyId, replies }) => ({ rootId, lastReplyId, replies })),
      events: sentTo.get(roomId) ?? 0,
    },
    long,
  };
};

const seedSmallRoom = async (tokens: Tokens, agentId: string, name: string) => {
  const roomId = await createRoom(tokens, agentId, name);
  const threads = [];
  for (let index = 0; index < SMALL_ROOM_MESSAGES / 5; index += 1)
    // eslint-disable-next-line no-await-in-loop
    threads.push(await seedThread(tokens, roomId, 4));
  const last = item(threads, threads.length - 1);
  return {
    roomId,
    name,
    lastRootId: last.rootId,
    lastReplyId: last.lastReplyId,
    threads: threads.map(({ rootId, lastReplyId, replies }) => ({ rootId, lastReplyId, replies })),
    probes: [],
    events: sentTo.get(roomId) ?? 0,
  };
};

const seedAccount = async (): Promise<Manifest> => {
  const started = Date.now();
  const username = `perf${randomUUID().slice(0, 8)}`;
  const registered = await matrixFetch<{ access_token: string; user_id: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  const agent = await registerAgentAccount(homeserver, 'perf');
  const tokens = { user: registered.access_token, agent: agent.accessToken };
  const bigNames = ['Release planning', 'Customer support', 'Research notes'];
  const big = await Promise.all(
    bigNames.map((name, index) => seedBigRoom(tokens, agent.userId, name, index === 0))
  );
  const smallNames = Array.from({ length: SPACES * ROOMS_PER_SPACE + HOME_SMALL_ROOMS }, (_, index) =>
    `${pick(['Ops', 'Team', 'Project', 'Design', 'Finance', 'Travel'])} ${pick(WORDS)} ${index + 1}`
  );
  const small = await pool(
    smallNames.map((name) => () => seedSmallRoom(tokens, agent.userId, name)),
    8
  );
  const spaces = [];
  for (let index = 0; index < SPACES; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const spaceId = await createPrivateSpace(homeserver, tokens.user, {
      name: item(['Engineering', 'Operations', 'Clients', 'Personal'], index),
      topic: 'Rooms of one area',
    });
    const rooms = small.slice(index * ROOMS_PER_SPACE, (index + 1) * ROOMS_PER_SPACE);
    // eslint-disable-next-line no-await-in-loop
    for (const room of rooms) await addRoomToSpace(homeserver, tokens.user, spaceId, room.roomId);
    spaces.push({ spaceId, rooms });
  }
  return {
    homeserver,
    username,
    userId: registered.user_id,
    bigRooms: big.map(({ room }) => room),
    homeSmallRooms: small.slice(SPACES * ROOMS_PER_SPACE),
    spaces,
    longThread: item(big, 0).long!,
    totalEvents: sent,
    seedSeconds: (Date.now() - started) / 1000,
  };
};

// The page side: long tasks, event timings, frame times and "first painted" marks.
type PerfWindow = Window & {
  __perf: {
    longTasks: { start: number; duration: number }[];
    events: { name: string; start: number; duration: number }[];
    frames: number[] | null;
    marks: Record<string, number>;
    lastPointerDown: number;
    keys: number[];
  };
  __perfWatch: (name: string, ids: string[], minRows?: number) => void;
};
const installProbe = () => {
  const target = window as unknown as PerfWindow;
  const perf: PerfWindow['__perf'] = {
    longTasks: [],
    events: [],
    frames: null,
    marks: {},
    lastPointerDown: 0,
    keys: [],
  };
  target.__perf = perf;
  // Every time is absolute (epoch milliseconds), so marks compare across a reload.
  const abs = (time: number) => performance.timeOrigin + time;
  perf.lastPointerDown = Number(sessionStorage.getItem('perf:pointerdown') ?? 0);
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        perf.longTasks.push({ start: abs(entry.startTime), duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        perf.events.push({ name: entry.name, start: abs(entry.startTime), duration: entry.duration });
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
  } catch {
    // WebKit has neither entry type.
  }
  document.addEventListener('pointerdown', (event) => {
    perf.lastPointerDown = abs(event.timeStamp);
    sessionStorage.setItem('perf:pointerdown', String(perf.lastPointerDown));
  }, true);
  // Each keystroke: from the key event to the start of the next frame, which paints its result.
  document.addEventListener('keydown', (event) => {
    const start = event.timeStamp;
    requestAnimationFrame(() => perf.keys.push(performance.now() - start));
  }, true);
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    if (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth)
      return false;
    return element.checkVisibility
      ? element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      : true;
  };
  const shown = (ids: string[]) =>
    ids.some((id) =>
      Array.from(
        document.querySelectorAll(
          `[data-thread-root-id="${id}"],[data-message-id="${id}"],[data-event-id="${id}"]`
        )
      ).some(visible)
    );
  // Marks `name` at the first frame in which one of the events is painted (or, with minRows,
  // the room list holds that many rows).
  target.__perfWatch = (name, ids, minRows) => {
    const deadline = performance.now() + 120_000;
    const tick = () => {
      if (perf.marks[name] !== undefined || performance.now() > deadline) return;
      const done =
        minRows !== undefined
          ? Array.from(document.querySelectorAll('[data-room-id]')).filter(visible).length >= minRows
          : shown(ids);
      if (done) perf.marks[name] = abs(performance.now());
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  // A load watches the room list and the stored target from the start.
  const startup = sessionStorage.getItem('perf:startup');
  if (startup) {
    const { ids, rows } = JSON.parse(startup) as { ids: string[]; rows: number };
    target.__perfWatch('firstRoomRow', [], 1);
    target.__perfWatch('roomList', [], rows);
    if (ids.length) target.__perfWatch('timeline', ids);
  }
};

const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => {
    if (!sorted.length) return NaN;
    const position = (sorted.length - 1) * q;
    const low = Math.floor(position);
    return (
      item(sorted, low) + (item(sorted, Math.ceil(position)) - item(sorted, low)) * (position - low)
    );
  };
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    n: sorted.length,
    median: round(at(0.5)),
    p25: round(at(0.25)),
    p75: round(at(0.75)),
    min: round(sorted[0] ?? NaN),
    max: round(sorted[sorted.length - 1] ?? NaN),
  };
};
const report = (name: string, data: Record<string, unknown>) => {
  mkdirSync(OUT_DIR, { recursive: true });
  const record = { name, cpuThrottle: CPU_THROTTLE, runs: RUNS, ...data };
  writeFileSync(`${OUT_DIR}/${name}${CPU_THROTTLE > 1 ? `-x${CPU_THROTTLE}` : ''}.json`, `${JSON.stringify(record, null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(`PERF ${JSON.stringify(record)}`);
};

const readPerf = (page: Page) => page.evaluate(() => (window as unknown as PerfWindow).__perf);
const waitMark = async (page: Page, name: string, timeout = 60_000) => {
  await expect
    .poll(() => page.evaluate((mark) => (window as unknown as PerfWindow).__perf.marks[mark], name), {
      timeout,
      intervals: [50],
    })
    .toBeDefined();
  const time = await page.evaluate(
    (mark) => (window as unknown as PerfWindow).__perf.marks[mark],
    name
  );
  if (time === undefined) throw new Error(`No ${name} mark`);
  return time;
};
const longTasksBetween = (
  perf: PerfWindow['__perf'],
  from: number,
  to: number
): { count: number; blocking: number; total: number } => {
  const inside = perf.longTasks.filter((task) => task.start >= from && task.start < to);
  return {
    count: inside.length,
    total: Math.round(inside.reduce((sum, task) => sum + task.duration, 0)),
    blocking: Math.round(inside.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0)),
  };
};

let manifest: Manifest;
const homeRows = () => BIG_ROOMS + HOME_SMALL_ROOMS;

const newContext = async (browser: import('@playwright/test').Browser) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  await context.addInitScript(installProbe);
  // PERF_CPU_THROTTLE=4 slows the page's CPU four times, as on a slower laptop or phone.
  if (CPU_THROTTLE > 1)
    context.on('page', (page) => {
      void context
        .newCDPSession(page)
        .then((session) => session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE }));
    });
  return context;
};
/**
 * With PERF_CPU_PROFILE=1, records a CPU profile of `action` into test-results/perf/<name>.cpuprofile,
 * with PERF_TRACE=1 a Chrome trace into <name>.trace.json (scripts/perf/trace-summary.mjs reads it).
 * Either slows the page, so its timings are not comparable with an unprofiled run.
 */
const profiled = async <T>(page: Page, name: string, action: () => Promise<T>): Promise<T> => {
  if (process.env.PERF_TRACE === '1') {
    // A Chrome trace instead: style, layout, paint and script time on the page's main thread.
    const browser = page.context().browser()!;
    await browser.startTracing(page, {
      categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'blink'],
    });
    const result = await action();
    const trace = await browser.stopTracing();
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(`${OUT_DIR}/${name}.trace.json`, trace);
    return result;
  }
  if (process.env.PERF_CPU_PROFILE !== '1') return action();
  const session = await page.context().newCDPSession(page);
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval', { interval: 200 });
  await session.send('Profiler.start');
  const result = await action();
  const { profile } = await session.send('Profiler.stop');
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/${name}.cpuprofile`, JSON.stringify(profile));
  await session.detach();
  return result;
};
const signIn = async (context: BrowserContext) => {
  const page = await context.newPage();
  await loginWithPassword(page, { homeserver, username: manifest.username, password: PASSWORD });
  await expect(page.getByRole('navigation', { name: 'Home', exact: true }).locator('[data-room-id]'))
    .toHaveCount(homeRows(), { timeout: 60_000 });
  return page;
};
const skipProfile = <T>(_page: Page, _name: string, action: () => Promise<T>) => action();

type Work = { scriptMs: number; taskMs: number; layoutMs: number; styleMs: number };
/**
 * The page's main-thread work so far (Chrome's Performance domain): script, all tasks, layout and
 * style, in milliseconds. Subtract two readings for the work an interaction cost, which frame
 * times on a fast machine do not show.
 */
const workMeter = async (page: Page) => {
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  return async (): Promise<Work> => {
    const { metrics } = await session.send('Performance.getMetrics');
    const seconds = (name: string) => metrics.find((metric) => metric.name === name)?.value ?? 0;
    return {
      scriptMs: seconds('ScriptDuration') * 1000,
      taskMs: seconds('TaskDuration') * 1000,
      layoutMs: seconds('LayoutDuration') * 1000,
      styleMs: seconds('RecalcStyleDuration') * 1000,
    };
  };
};
const workSince = (before: Work, after: Work): Work => ({
  scriptMs: after.scriptMs - before.scriptMs,
  taskMs: after.taskMs - before.taskMs,
  layoutMs: after.layoutMs - before.layoutMs,
  styleMs: after.styleMs - before.styleMs,
});
const workStats = (list: Work[]) => ({
  scriptMs: stats(list.map((work) => work.scriptMs)),
  taskMs: stats(list.map((work) => work.taskMs)),
  layoutMs: stats(list.map((work) => work.layoutMs)),
  styleMs: stats(list.map((work) => work.styleMs)),
});
const homeRow = (page: Page, roomId: string) =>
  page.getByRole('navigation', { name: 'Home', exact: true }).locator(`[data-room-id="${roomId}"]`);
/** Clicks a room in the Home list; resolves with the time from pointerdown to its painted timeline. */
const switchTo = async (page: Page, room: RoomFixture, mark: string) => {
  await page.evaluate(
    ({ name, ids }) => (window as unknown as PerfWindow).__perfWatch(name, ids),
    { name: mark, ids: [room.lastRootId, room.lastReplyId] }
  );
  await homeRow(page, room.roomId).click();
  const end = await waitMark(page, mark);
  const perf = await readPerf(page);
  return { ms: end - perf.lastPointerDown, longTasks: longTasksBetween(perf, perf.lastPointerDown, end) };
};

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
  trace: 'off',
  video: 'off',
  screenshot: 'off',
  actionTimeout: 20_000,
});

test.describe('PERF: client speed with a realistic account', () => {
  test.skip(!enabled, 'Set PERF_CLIENT_SPEED=1 to run the client speed measurements');
  test.describe.configure({ timeout: 900_000, retries: 0 });

  test.beforeAll(async () => {
    test.setTimeout(1_800_000);
    if (existsSync(MANIFEST)) {
      manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
      return;
    }
    manifest = await seedAccount();
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    // eslint-disable-next-line no-console
    console.log(`PERF seeded ${manifest.totalEvents} events in ${manifest.seedSeconds} s`);
  });

  test('cold start and warm start', async ({ browser }) => {
    const cold = { firstRoomRow: [] as number[], roomList: [] as number[] };
    const warm = {
      firstRoomRow: [] as number[],
      roomList: [] as number[],
      timeline: [] as number[],
      fcp: [] as number[],
    };
    const coldBlocking: number[] = [];
    const warmBlocking: number[] = [];
    const target = item(manifest.bigRooms, 0);
    for (let run = 0; run < RUNS; run += 1) {
      // Cold: a new browser profile (no HTTP cache, worker or stored data) signs in.
      // eslint-disable-next-line no-await-in-loop
      const context = await newContext(browser);
      // eslint-disable-next-line no-await-in-loop
      const page = await context.newPage();
      // eslint-disable-next-line no-await-in-loop
      await (run === 0 ? profiled : skipProfile)(page, 'cold-start', () =>
        loginWithPasswordTimed(page, cold, coldBlocking)
      );
      // The app opens on Home; open the large room once so a reload returns to it.
      // eslint-disable-next-line no-await-in-loop
      await switchTo(page, target, 'prime');
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(5_000);
      // Warm: reload with the HTTP cache, service worker and stored data of that session.
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate(
        (value) => sessionStorage.setItem('perf:startup', value),
        JSON.stringify({ ids: [target.lastRootId, target.lastReplyId], rows: homeRows() })
      );
      // eslint-disable-next-line no-await-in-loop
      const origin = await (run === 0 ? profiled : skipProfile)(page, 'warm-start', async () => {
        await page.reload();
        const time = await page.evaluate(() => performance.timeOrigin);
        await waitMark(page, 'timeline');
        return time;
      });
      for (const name of ['firstRoomRow', 'roomList', 'timeline'] as const)
        // eslint-disable-next-line no-await-in-loop
        warm[name].push((await waitMark(page, name)) - origin);
      // eslint-disable-next-line no-await-in-loop
      const perf = await readPerf(page);
      // eslint-disable-next-line no-await-in-loop
      const fcp = await page.evaluate(
        () => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? NaN
      );
      warm.fcp.push(fcp);
      warmBlocking.push(longTasksBetween(perf, origin, perf.marks.timeline ?? origin).blocking);
      // eslint-disable-next-line no-await-in-loop
      await context.close();
    }
    report('cold-start', {
      note: 'from the Login click to the first room row, the full Home list and the default room painted',
      ...Object.fromEntries(Object.entries(cold).map(([name, values]) => [name, stats(values)])),
      blockingMs: stats(coldBlocking),
      raw: cold,
    });
    report('warm-start', {
      note: 'reload of a signed-in tab showing a large room: navigation start to marks',
      ...Object.fromEntries(Object.entries(warm).map(([name, values]) => [name, stats(values)])),
      blockingMs: stats(warmBlocking),
      raw: warm,
    });

    async function loginWithPasswordTimed(
      page: Page,
      into: { firstRoomRow: number[]; roomList: number[] },
      blocking: number[]
    ) {
      await page.goto(buildLoginPath(homeserver, false));
      // If the sign-in loads a new document, its probe watches the list from the start.
      await page.evaluate(
        (value) => sessionStorage.setItem('perf:startup', value),
        JSON.stringify({ ids: [], rows: homeRows() })
      );
      await page.locator('input[name="usernameInput"]').fill(manifest.username);
      await page.locator('input[name="passwordInput"]').fill(PASSWORD);
      await page.getByRole('button', { name: 'Login' }).click();
      await page.evaluate((rows) => {
        const perfWindow = window as unknown as PerfWindow;
        perfWindow.__perfWatch('firstRoomRow', [], 1);
        perfWindow.__perfWatch('roomList', [], rows);
      }, homeRows());
      const first = await waitMark(page, 'firstRoomRow');
      const list = await waitMark(page, 'roomList');
      const perf = await readPerf(page);
      const start = perf.lastPointerDown;
      into.firstRoomRow.push(first - start);
      into.roomList.push(list - start);
      blocking.push(longTasksBetween(perf, start, list).blocking);
      await page.evaluate(() => sessionStorage.removeItem('perf:startup'));
    }
  });

  test('switching rooms', async ({ browser }) => {
    const context = await newContext(browser);
    const page = await signIn(context);
    const order = [
      item(manifest.bigRooms, 0),
      item(manifest.homeSmallRooms, 0),
      item(manifest.bigRooms, 1),
      item(manifest.homeSmallRooms, 1),
      item(manifest.bigRooms, 2),
    ];
    const first = { big: [] as number[], small: [] as number[] };
    const again = { big: [] as number[], small: [] as number[] };
    const blocking: number[] = [];
    const work: Work[] = [];
    const readWork = await workMeter(page);
    // Start from a small room that is not in the cycle.
    await switchTo(page, item(manifest.homeSmallRooms, 2), 'start');
    await page.waitForTimeout(3_000);
    for (let round = 0; round <= RUNS; round += 1) {
      for (const [index, room] of order.entries()) {
        // eslint-disable-next-line no-await-in-loop
        const before = await readWork();
        // eslint-disable-next-line no-await-in-loop
        const result = await (round === 1 && index === 2 ? profiled : skipProfile)(
          page,
          'room-switch',
          () => switchTo(page, room, `switch-${round}-${index}`)
        );
        // eslint-disable-next-line no-await-in-loop
        work.push(workSince(before, await readWork()));
        const kind: 'big' | 'small' = manifest.bigRooms.includes(room) ? 'big' : 'small';
        (round === 0 ? first : again)[kind].push(result.ms);
        if (round > 0) blocking.push(result.longTasks.blocking);
        // Let the room settle (thread previews, receipts) as a reader would before moving on.
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(1_500);
      }
    }
    report('room-switch', {
      note: 'pointerdown on a Home row to the newest thread of that room painted',
      firstVisitBig: stats(first.big),
      firstVisitSmall: stats(first.small),
      revisitBig: stats(again.big),
      revisitSmall: stats(again.small),
      revisitBlockingMs: stats(blocking),
      mainThreadWorkPerSwitch: workStats(work),
      raw: { first, again },
    });
    await context.close();
  });

  test('opening a thread', async ({ browser }) => {
    const context = await newContext(browser);
    const page = await signIn(context);
    const room = item(manifest.bigRooms, 1);
    await switchTo(page, room, 'room');
    await page.waitForTimeout(3_000);
    // The probe threads (same size in every job) are the newest after the last exchange.
    const threads = room.probes.slice(0, RUNS);
    expect(threads).toHaveLength(RUNS);
    const firstOpen: number[] = [];
    const reopen: number[] = [];
    const blocking: number[] = [];
    const work: Work[] = [];
    const readWork = await workMeter(page);
    const open = async (thread: RoomFixture['threads'][number], mark: string) => {
      const before = await readWork();
      await page.evaluate(
        ({ name, ids }) => (window as unknown as PerfWindow).__perfWatch(name, ids),
        { name: mark, ids: [thread.lastReplyId] }
      );
      await page.locator(`main [data-thread-root-id="${thread.rootId}"]`).first().click();
      const end = await waitMark(page, mark);
      const perf = await readPerf(page);
      blocking.push(longTasksBetween(perf, perf.lastPointerDown, end).blocking);
      const ms = end - perf.lastPointerDown;
      work.push(workSince(before, await readWork()));
      await page
        .locator('[data-thread-context-banner]')
        .getByRole('button', { name: 'Back', exact: true })
        .click();
      await expect(page.locator(`main [data-thread-root-id="${thread.rootId}"]`).first()).toBeVisible();
      await page.waitForTimeout(1_000);
      return ms;
    };
    for (const [index, thread] of threads.entries())
      // eslint-disable-next-line no-await-in-loop
      firstOpen.push(
        await (index === 0 ? profiled : skipProfile)(page, 'thread-open', () =>
          open(thread, `thread-${index}`)
        )
      );
    for (const [index, thread] of threads.entries())
      // eslint-disable-next-line no-await-in-loop
      reopen.push(await open(thread, `thread-again-${index}`));
    report('thread-open', {
      note: 'pointerdown on a thread card to its newest reply painted in the thread panel',
      firstOpen: stats(firstOpen),
      reopen: stats(reopen),
      blockingMs: stats(blocking),
      mainThreadWorkPerOpen: workStats(work),
      raw: { firstOpen, reopen },
    });
    await context.close();
  });

  test('scrolling back through long history', async ({ browser }) => {
    const context = await newContext(browser);
    const page = await signIn(context);
    const results: Record<
      string,
      {
        frames: number[];
        longTasks: number[];
        blocking: number[];
        loaded: number[];
        pages: number[];
        scrolled: number[];
        work: Work[];
      }
    > = {};
    const readWork = await workMeter(page);
    const scrollBack = async (name: string, anchorId: string) => {
      const scroller = await page.evaluateHandle((id) => {
        let node: HTMLElement | null = document.querySelector<HTMLElement>(
          `[data-message-id="${id}"],[data-event-id="${id}"],[data-thread-root-id="${id}"]`
        );
        while (node && !['auto', 'scroll'].includes(getComputedStyle(node).overflowY))
          node = node.parentElement;
        return node;
      }, anchorId);
      const box = await scroller.asElement()!.boundingBox();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      let pages = 0;
      const countPage = (request: import('@playwright/test').Request) => {
        if (/\/(messages|relations)\b/.test(request.url())) pages += 1;
      };
      page.on('request', countPage);
      await scroller.evaluate((view) => {
        const perfWindow = window as unknown as PerfWindow & { __perfSeen: Set<string> };
        const perf = perfWindow.__perf;
        perf.frames = [];
        perfWindow.__perfSeen = new Set();
        let last = performance.now();
        const tick = (now: number) => {
          if (!perf.frames) return;
          perf.frames.push(now - last);
          last = now;
          for (const row of (view as HTMLElement).querySelectorAll('[data-message-id]'))
            perfWindow.__perfSeen.add(row.getAttribute('data-message-id') ?? '');
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const fromBottom = (view: HTMLElement | null) =>
        view ? view.scrollHeight - view.scrollTop - view.clientHeight : 0;
      const startDistance = await scroller.evaluate(fromBottom);
      const workBefore = await readWork();
      const start = await page.evaluate(() => performance.timeOrigin + performance.now());
      // About 15 s of reading upward: flicks of 8 wheel notches 40 ms apart, each followed by a
      // 300 ms pause, as a reader scrolls and glances (the list loads older rows at rest).
      for (let flick = 0; flick < 24; flick += 1) {
        for (let notch = 0; notch < 8; notch += 1) {
          // eslint-disable-next-line no-await-in-loop
          await page.mouse.wheel(0, -320);
          // eslint-disable-next-line no-await-in-loop
          await page.waitForTimeout(40);
        }
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(300);
      }
      const end = await page.evaluate(() => performance.timeOrigin + performance.now());
      page.off('request', countPage);
      const work = workSince(workBefore, await readWork());
      const scrolled = (await scroller.evaluate(fromBottom)) - startDistance;
      await page.screenshot({ path: `${OUT_DIR}/scroll-${name}-${results[name]?.frames.length ?? 0}.png` });
      const perf = await page.evaluate(() => {
        const perfWindow = window as unknown as PerfWindow & { __perfSeen: Set<string> };
        const state = perfWindow.__perf;
        const frames = state.frames ?? [];
        state.frames = null;
        return { frames, seen: perfWindow.__perfSeen.size };
      });
      const tasks = longTasksBetween(await readPerf(page), start, end);
      const entry = (results[name] ??= {
        frames: [],
        longTasks: [],
        blocking: [],
        loaded: [],
        pages: [],
        scrolled: [],
        work: [],
      });
      entry.frames.push(...perf.frames.slice(1));
      entry.longTasks.push(tasks.count);
      entry.blocking.push(tasks.blocking);
      entry.loaded.push(perf.seen);
      entry.pages.push(pages);
      entry.scrolled.push(Math.round(scrolled));
      entry.work.push(work);
    };
    const classicRoom = item(manifest.bigRooms, 2);
    await seedRoomOverviewState({
      page,
      roomId: classicRoom.roomId,
      userId: manifest.userId,
      viewMode: 'classic',
      filterState: createDefaultThreadFilterState(),
    });
    for (let run = 0; run < RUNS; run += 1) {
      // Each run starts from a fresh load, so the history above comes from the cache and server.
      // eslint-disable-next-line no-await-in-loop
      await page.goto(`/home/${encodeURIComponent(classicRoom.roomId)}`);
      // eslint-disable-next-line no-await-in-loop
      // Classic shows thread replies in the timeline, so the newest reply is the newest row.
      await expect(page.locator(`[data-message-id="${classicRoom.lastReplyId}"]`)).toBeVisible({
        timeout: 60_000,
      });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(2_000);
      // eslint-disable-next-line no-await-in-loop
      await (run === 0 ? profiled : skipProfile)(page, 'scroll-classic', () =>
        scrollBack('classicRoom', classicRoom.lastReplyId)
      );

      const long = manifest.longThread;
      // eslint-disable-next-line no-await-in-loop
      await page.goto(
        `/home/${encodeURIComponent(long.roomId)}/?threadId=${encodeURIComponent(long.rootId)}`
      );
      // eslint-disable-next-line no-await-in-loop
      await expect(page.locator(`[data-message-id="${long.lastReplyId}"]`)).toBeVisible({
        timeout: 60_000,
      });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(2_000);
      // eslint-disable-next-line no-await-in-loop
      await (run === 0 ? profiled : skipProfile)(page, 'scroll-thread', () =>
        scrollBack('longThread', long.lastReplyId)
      );
    }
    const summary = Object.fromEntries(
      Object.entries(results).map(([name, data]) => [
        name,
        {
          frameMs: { ...stats(data.frames), ...percentiles(data.frames) },
          droppedFramePercent:
            Math.round((data.frames.filter((frame) => frame > 34).length / data.frames.length) * 1000) / 10,
          longTasksPerRun: stats(data.longTasks),
          blockingMsPerRun: stats(data.blocking),
          messagesPassed: stats(data.loaded),
          historyRequests: stats(data.pages),
          scrolledPx: stats(data.scrolled),
          mainThreadWorkPerRun: workStats(data.work),
        },
      ])
    );
    report('scroll-back', {
      note: '24 flicks of 8 wheel notches of 320 px (40 ms apart, 300 ms rest); frames over 34 ms count as dropped',
      ...summary,
      raw: Object.fromEntries(
        Object.entries(results).map(([name, data]) => [name, { ...data, frames: undefined, work: undefined }])
      ),
    });
    await context.close();

    function percentiles(values: number[]) {
      const sorted = [...values].sort((a, b) => a - b);
      const at = (q: number) =>
        Math.round(item(sorted, Math.floor((sorted.length - 1) * q)) * 10) / 10;
      return { p90: at(0.9), p95: at(0.95), p99: at(0.99) };
    }
  });

  test('typing in the composer', async ({ browser }) => {
    const context = await newContext(browser);
    const page = await signIn(context);
    await switchTo(page, item(manifest.bigRooms, 0), 'room');
    await page.waitForTimeout(3_000);
    const composer = page.locator('[data-editable-name="RoomInput"]');
    await composer.click();
    const perRun: number[] = [];
    const all: number[] = [];
    const work: Work[] = [];
    const readWork = await workMeter(page);

    const text = 'Could you check why the nightly build got slower after the last merge? Thanks';
    for (let run = 0; run < RUNS; run += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate(() => {
        (window as unknown as PerfWindow).__perf.keys = [];
      });
      // eslint-disable-next-line no-await-in-loop
      const before = await readWork();
      // eslint-disable-next-line no-await-in-loop
      await (run === 0 ? profiled : skipProfile)(page, 'typing', () =>
        page.keyboard.type(text, { delay: 30 })
      );
      // eslint-disable-next-line no-await-in-loop
      work.push(workSince(before, await readWork()));
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(300);
      // eslint-disable-next-line no-await-in-loop
      const perf = await readPerf(page);
      all.push(...perf.keys);
      perRun.push(stats(perf.keys).median);

      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press('ControlOrMeta+a');
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press('Backspace');
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(500);
    }
    const sorted = [...all].sort((a, b) => a - b);
    report('typing', {
      note: `${text.length} characters typed 30 ms apart in a large room's composer; keydown to the next frame (Event Timing durations are left out: headless frames make them unreliable)`,
      perKeyMs: stats(all),
      p95Ms: Math.round(item(sorted, Math.floor(sorted.length * 0.95)) * 10) / 10,
      runMedians: stats(perRun),
      mainThreadWorkPerRun: workStats(work),
    });
    await context.close();
  });
});
