import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { getHomeserver } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
} from '../helpers/matrix';
import { expectRoomCompact, toggleRoomView } from '../helpers/roomViewSwitch';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';
import { CHROMIUM_WITH_SCROLLBARS } from '../helpers/disposableAccounts';

/**
 * A room with 245 threads, each with a few replies whose agent answers streamed in as edits, and
 * some notes between them, among 25 rooms. The Compact view lists every thread at once. The Threads
 * view (newest first) lists the same threads at once too, whether the reader switches to it from
 * Compact or opens the room in it (after a reload, or on a device that holds nothing yet), and a
 * reader who scrolls down reaches the oldest thread without waiting for each screen, while the
 * rows on screen hold still. A reader who scrolls up through the Classic view (newest last)
 * reaches it too without ever running into the end of the loaded rows, while the rows on screen
 * hold still, and neither view asks for a page of history twice. Desktop (1280 by 800) with
 * classic scrollbars and a touch phone (390 by 844), in Chromium and, when the runner names it, in
 * WebKit. Set MANY_THREADS_SHOTS=<directory> to save each view and the numbers of each flick.
 *
 * The Threads view listed only the threads whose roots the room's timeline held, and the timeline
 * pages 200 events at a time, most of them replies and edits the view hides: each page added a few
 * threads, and the next page waited until the reader scrolled to the end again. The Classic view
 * asked for history only once the reader saw the end of its rows: every page or two the reader
 * ran into it, and waited for the page.
 */

const PASSWORD = 'many-threads-scroll-1';
const SHOTS = process.env.MANY_THREADS_SHOTS;
const homeserver = getHomeserver();
const DESKTOP = { viewport: { width: 1280, height: 800 } };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
type Device = 'desktop' | 'phone';
const THREADS = 245;
const NOTES = 30;
/** Edits of each streamed answer, as an agent's reply sends them while it streams. */
const STREAM_EDITS = 10;

const WORDS = (
  'the a deploy build branch cache config review merge check schedule server thread room ' +
  'message agent tool result error retry network latency timeout model token summary draft ' +
  'release notes migration backup database index query report chart metric alert queue worker'
).split(' ');
let seed = 11;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (list: string[]) => list[Math.floor(random() * list.length)] ?? 'note';
const sentence = (min: number, max: number) => {
  const words = Array.from({ length: min + Math.floor(random() * (max - min)) }, () => pick(WORDS));
  return `${words.join(' ').replace(/^./, (first) => first.toUpperCase())}.`;
};
const paragraph = (count: number) => Array.from({ length: count }, () => sentence(6, 16)).join(' ');
const note = (label: string) => ({
  msgtype: 'm.text',
  body: `${label}: ${paragraph(1 + Math.floor(random() * 2))}`,
});
const answer = () => {
  const items = Array.from({ length: 2 + Math.floor(random() * 3) }, () => sentence(4, 10));
  const text = paragraph(1 + Math.floor(random() * 2));
  return {
    msgtype: 'm.text',
    body: `${text}\n\n${items.map((item) => `- ${item}`).join('\n')}`,
    format: 'org.matrix.custom.html',
    formatted_body: `<p>${text}</p><ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`,
  };
};
const inThread = (rootId: string, previousId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: previousId },
  },
});
const editOf = (eventId: string, content: Record<string, unknown>) => ({
  ...content,
  body: `* ${String(content.body)}`,
  'm.new_content': content,
  'm.relates_to': { rel_type: 'm.replace', event_id: eventId },
});

const send = async (token: string, roomId: string, content: Record<string, unknown>) =>
  (
    await matrixFetch<{ event_id: string }>(
      homeserver,
      `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${randomUUID()}`,
      { method: 'PUT', accessToken: token, body: JSON.stringify(content) }
    )
  ).event_id;

/** Runs the tasks with at most `limit` at once. */
const pool = async (tasks: (() => Promise<unknown>)[], limit: number) => {
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < tasks.length) {
        const task = tasks[next];
        next += 1;
        // eslint-disable-next-line no-await-in-loop
        await task?.();
      }
    })
  );
};

type Fixture = {
  username: string;
  userId: string;
  roomId: string;
  /** Thread roots, oldest first. */
  roots: string[];
  /** Notes without replies. */
  notes: string[];
  /** Events in the room. */
  events: number;
};

const seedAccount = async (): Promise<Fixture> => {
  const username = `manythreads${randomUUID().slice(0, 8)}`;
  const person = await matrixFetch<{ access_token: string; user_id: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  const agent = await registerAgentAccount(homeserver, 'notes');
  const token = person.access_token;
  const roomId = await createPrivateRoom(homeserver, token, {
    name: 'Research notes',
    topic: 'Questions and the agent’s answers',
    invite: [agent.userId],
  });
  await joinRoom(homeserver, agent.accessToken, roomId);

  let events = 0;
  const rootAt = new Map<string, number>();
  const notes: string[] = [];
  // A thread: the person's question, the agent's answer streamed in edits, and maybe a follow-up
  // and a second answer.
  const thread = async (index: number) => {
    const rootId = await send(token, roomId, note(`Question ${index + 1}`));
    rootAt.set(rootId, index);
    events += 1;
    let previous = rootId;
    const rounds = 1 + Math.floor(random() * 2);
    for (let round = 0; round < rounds; round += 1) {
      if (round > 0) {
        // eslint-disable-next-line no-await-in-loop
        previous = await send(token, roomId, {
          ...note('Follow-up'),
          ...inThread(rootId, previous),
        });
        events += 1;
      }
      const final = answer();
      // eslint-disable-next-line no-await-in-loop
      const replyId = await send(agent.accessToken, roomId, {
        msgtype: 'm.text',
        body: '…',
        ...inThread(rootId, previous),
      });
      events += 1;
      for (let edit = 0; edit < STREAM_EDITS; edit += 1) {
        const partial =
          edit === STREAM_EDITS - 1
            ? final
            : {
                msgtype: 'm.text',
                body: final.body.slice(0, ((edit + 1) * final.body.length) / STREAM_EDITS),
              };
        // eslint-disable-next-line no-await-in-loop
        await send(agent.accessToken, roomId, editOf(replyId, partial));
        events += 1;
      }
      previous = replyId;
    }
  };
  const tasks: (() => Promise<unknown>)[] = [];
  const noteEvery = Math.floor(THREADS / NOTES);
  for (let index = 0; index < THREADS; index += 1) {
    tasks.push(() => thread(index));
    if (index % noteEvery === 0 && notes.length + tasks.length < THREADS + NOTES)
      tasks.push(async () => {
        notes.push(await send(token, roomId, note('Note')));
        events += 1;
      });
  }
  // A few threads at a time, so their replies interleave as conversations do.
  await pool(tasks, 4);

  await pool(
    Array.from({ length: 24 }, (_, index) => async () => {
      const otherId = await createPrivateRoom(homeserver, token, {
        name: `Project ${index + 1}`,
        topic: 'Another room of the account',
      });
      await send(token, otherId, note('Hello'));
    }),
    8
  );
  const roots = [...rootAt.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  return { username, userId: person.user_id, roomId, roots, notes, events };
};

/** The requests a page makes for the room's history and threads. */
type Requests = { messages: number; threads: number; relations: number; context: number };
const watchRequests = (page: Page, roomId: string) => {
  const counts: Requests = { messages: 0, threads: 0, relations: 0, context: 0 };
  const room = `/rooms/${encodeURIComponent(roomId)}/`;
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (!pathname.includes(room)) return;
    if (pathname.endsWith('/messages')) counts.messages += 1;
    else if (pathname.endsWith('/threads')) counts.threads += 1;
    else if (pathname.includes('/relations/')) counts.relations += 1;
    else if (pathname.includes('/context/')) counts.context += 1;
  });
  return counts;
};

/** The room timeline's scroll area: the nearest scrolling box around its virtual list. */
const findScroller = (page: Page) =>
  page.getByTestId('room-virtual-inner').evaluateHandle((inner) => {
    let node = inner.parentElement;
    while (node && !['auto', 'scroll'].includes(getComputedStyle(node).overflowY))
      node = node.parentElement;
    if (!node) throw new Error('The timeline has no scroll area');
    return node;
  });
type Scroller = Awaited<ReturnType<typeof findScroller>>;

/**
 * How many of `roots` the Threads view holds now: its list read top to bottom in half screens while
 * the room's history pages wait, so only rows it held already show. The view returns to its top.
 */
const countHeldRoots = async (page: Page, roots: string[], label: string): Promise<number> => {
  const waiting: (() => void)[] = [];
  const isHistoryPage = (url: URL) => url.pathname.endsWith('/messages');
  await page.route(isHistoryPage, (route) => {
    waiting.push(() => void route.continue().catch(() => undefined));
  });
  try {
    const scroller = await findScroller(page);
    const held = await scroller.evaluate(async (view, rootIds) => {
      const wanted = new Set(rootIds);
      const seen = new Set<string>();
      const frame = () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      for (let step = 0; step < 2_000; step += 1) {
        view.scrollTop = (step * view.clientHeight) / 2;
        // eslint-disable-next-line no-await-in-loop
        await frame();
        view.querySelectorAll<HTMLElement>('[data-message-id]').forEach((row) => {
          const id = row.dataset.messageId;
          if (id && wanted.has(id)) seen.add(id);
        });
        if (view.scrollTop + view.clientHeight >= view.scrollHeight - 1) break;
      }
      return seen.size;
    }, roots);
    // The end of what the view holds: the oldest thread, or the edge where history loads.
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/${label}-held-end.png` });
    }
    await scroller.evaluate(async (view) => {
      view.scrollTop = 0;
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    });
    return held;
  } finally {
    await page.unroute(isHistoryPage);
    waiting.forEach((release) => release());
  }
};

type WatchWindow = Window & { manyThreadsWatch?: { seen: Set<string>; stop: () => void } };

/** Records every frame's rendered message rows, so a row that ever showed counts as seen. */
const startWatch = (scroller: Scroller) =>
  scroller.evaluate((view) => {
    const seen = new Set<string>();
    let running = true;
    const tick = () => {
      if (!running) return;
      view.querySelectorAll<HTMLElement>('[data-message-id]').forEach((row) => {
        if (row.dataset.messageId) seen.add(row.dataset.messageId);
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    (window as WatchWindow).manyThreadsWatch = {
      seen,
      stop: () => {
        running = false;
      },
    };
  });

/** The first row fully inside the visible band and its top, to see whether it moves. */
const readPlace = (scroller: Scroller) =>
  scroller.evaluate((view) => {
    const style = getComputedStyle(view);
    const box = view.getBoundingClientRect();
    const bandTop = box.top + (Number.parseFloat(style.scrollPaddingTop) || 0);
    const bandBottom = box.bottom - (Number.parseFloat(style.scrollPaddingBottom) || 0);
    const rows = Array.from(view.querySelectorAll<HTMLElement>('[data-message-id]'))
      .map((row) => ({ id: row.dataset.messageId ?? '', rect: row.getBoundingClientRect() }))
      .filter(({ rect }) => rect.height > 0 && rect.top >= bandTop && rect.bottom <= bandBottom)
      .sort((a, b) => a.rect.top - b.rect.top);
    const first = rows[0];
    return { id: first?.id, top: first?.rect.top ?? 0 };
  });

/** Waits until the scroll position has not moved for five frames: the flick has run out. */
const settle = (scroller: Scroller) =>
  scroller.evaluate(async (view) => {
    let previous = view.scrollTop;
    for (let still = 0, frames = 0; still < 5 && frames < 90; frames += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        requestAnimationFrame(resolve);
      });
      still = view.scrollTop === previous ? still + 1 : 0;
      previous = view.scrollTop;
    }
  });

const topOf = (scroller: Scroller, id: string) =>
  scroller.evaluate(
    (view, rowId) =>
      view.querySelector<HTMLElement>(`[data-message-id="${rowId}"]`)?.getBoundingClientRect().top,
    id
  );

/** Whether the row is inside the visible band. */
const inView = (scroller: Scroller, id: string) =>
  scroller.evaluate((view, rowId) => {
    const row = view.querySelector<HTMLElement>(`[data-message-id="${rowId}"]`);
    if (!row) return false;
    const style = getComputedStyle(view);
    const box = view.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    return (
      rect.height > 0 &&
      rect.bottom > box.top + (Number.parseFloat(style.scrollPaddingTop) || 0) &&
      rect.top < box.bottom - (Number.parseFloat(style.scrollPaddingBottom) || 0)
    );
  }, id);

const NOTCH_PX = 200;
const NOTCHES = 4;
const FLICK_PX = NOTCH_PX * NOTCHES;

/**
 * One flick: four wheel notches 40 ms apart on a desktop; on a phone a touch, four steps of the
 * same size and the lift.
 */
const flick = async (page: Page, scroller: Scroller, device: Device, down: boolean) => {
  const delta = down ? NOTCH_PX : -NOTCH_PX;
  if (device === 'phone')
    await scroller.evaluate((view) =>
      view.dispatchEvent(new Event('touchstart', { bubbles: true }))
    );
  for (let notch = 0; notch < NOTCHES; notch += 1) {
    if (device === 'desktop') {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, delta);
    } else {
      // eslint-disable-next-line no-await-in-loop
      await scroller.evaluate((view, by) => view.scrollBy({ top: by }), delta);
    }
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(40);
  }
  if (device === 'phone')
    await scroller.evaluate((view) => view.dispatchEvent(new Event('touchend', { bubbles: true })));
};

type Step = {
  requests: Requests;
  rows: number;
  stalled: boolean;
  /** How far the flick moved the rows short of, or past, its own distance. */
  off: number;
  drift: number;
};
type Reading = {
  label: string;
  steps: Step[];
  reached: boolean;
  seconds: number;
  requests: Requests;
  maxDrift: number;
  stalls: number;
  maxOff: number;
};

const diff = (after: Requests, before: Requests): Requests => ({
  messages: after.messages - before.messages,
  threads: after.threads - before.threads,
  relations: after.relations - before.relations,
  context: after.context - before.context,
});

/**
 * Reads towards older rows like a person: a flick, a glance, until `target` is in view or nothing
 * new shows for fifteen flicks. Each step records the requests it caused, the rows it showed for
 * the first time, whether the flick ran into the end of the loaded rows while older ones remained,
 * and how far the row at the top of the view moved in the 400 ms after the flick ran out.
 */
const readToOldest = async (
  page: Page,
  device: Device,
  down: boolean,
  target: string,
  requests: Requests,
  label: string
): Promise<Reading> => {
  const scroller = await findScroller(page);
  const box = await scroller.boundingBox();
  if (!box) throw new Error('The timeline is not laid out');
  if (device === 'desktop') await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await startWatch(scroller);
  const start = Date.now();
  const before = { ...requests };
  const steps: Step[] = [];
  let reached = false;
  let idle = 0;
  let seen = await page.evaluate(() => (window as WatchWindow).manyThreadsWatch?.seen.size ?? 0);
  while (idle < 15 && steps.length < 400) {
    const stepBefore = { ...requests };
    // eslint-disable-next-line no-await-in-loop
    const from = await readPlace(scroller);
    // eslint-disable-next-line no-await-in-loop
    await flick(page, scroller, device, down);
    // eslint-disable-next-line no-await-in-loop
    await settle(scroller);
    // eslint-disable-next-line no-await-in-loop
    const moved = from.id ? await topOf(scroller, from.id) : undefined;
    // eslint-disable-next-line no-await-in-loop
    const place = await readPlace(scroller);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(400);
    // eslint-disable-next-line no-await-in-loop
    const later = place.id ? await topOf(scroller, place.id) : undefined;
    // eslint-disable-next-line no-await-in-loop
    reached = await inView(scroller, target);
    // eslint-disable-next-line no-await-in-loop
    const now = await page.evaluate(() => (window as WatchWindow).manyThreadsWatch?.seen.size ?? 0);
    steps.push({
      requests: diff(requests, stepBefore),
      rows: now - seen,
      // The flick ran into the end of the loaded rows: the rows moved less than half its distance.
      stalled: !reached && moved !== undefined && Math.abs(moved - from.top) < FLICK_PX / 2,
      off:
        reached || moved === undefined
          ? 0
          : Math.round(Math.abs(Math.abs(moved - from.top) - FLICK_PX)),
      drift: later === undefined ? 0 : Math.round(Math.abs(later - place.top)),
    });
    if (reached) break;
    idle = now === seen ? idle + 1 : 0;
    seen = now;
  }
  const seconds = (Date.now() - start) / 1000;
  await page.evaluate(() => (window as WatchWindow).manyThreadsWatch?.stop());
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${label}-oldest.png` });
  }
  return {
    label,
    steps,
    reached,
    seconds,
    requests: diff(requests, before),
    maxDrift: Math.max(0, ...steps.map((step) => step.drift)),
    stalls: steps.filter((step) => step.stalled).length,
    maxOff: Math.max(0, ...steps.map((step) => step.off)),
  };
};

const report = (reading: Reading, heldRoots?: number) => {
  const summary = {
    ...reading,
    heldRoots,
    steps: reading.steps.length,
    perStep: reading.steps.map(
      (step) =>
        `${step.rows}r/${step.requests.messages}m/${step.requests.threads}t/${
          step.requests.relations
        }rel/${step.requests.context}c${step.stalled ? '/stall' : ''}${
          step.off > 2 ? `/off${step.off}` : ''
        }${step.drift > 2 ? `/drift${step.drift}` : ''}`
    ),
  };
  // eslint-disable-next-line no-console
  console.log(`[many-threads] ${JSON.stringify(summary)}`);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(`${SHOTS}/${reading.label}.json`, JSON.stringify(summary, null, 2));
  }
};

let fixture: Fixture;

/** Rows on screen move no more than subpixel rounding while rows load around them. */
const MAX_DRIFT_PX = 2;
/**
 * Flicks that ran into the end of the loaded rows before the oldest thread was in view: the reader
 * waited for rows. In the Threads view the last one, where the view pages in the history below its
 * last thread, is allowed. The Classic view pages its history a screen ahead of the reader, so a
 * reader never waits for it. How far each flick moved the rows short of or past its distance is
 * reported (a mouse wheel's notches move by their own distance in some engines only).
 */
const MAX_STALLS = 1;
const MAX_CLASSIC_STALLS = 0;

/** Reports the reading and checks it; `held` is the Threads view's count of held threads. */
const check = (reading: Reading, held?: number) => {
  report(reading, held);
  const { label } = reading;
  expect(reading.reached, `${label}: the oldest thread came into view`).toBe(true);
  if (held !== undefined)
    expect(held, `${label}: threads the Threads view holds without a page`).toBe(THREADS);
  expect(reading.stalls, `${label}: flicks that ran into the end of the rows`).toBeLessThanOrEqual(
    held === undefined ? MAX_CLASSIC_STALLS : MAX_STALLS
  );
  expect(
    reading.maxDrift,
    `${label}: px the rows on screen moved as rows loaded`
  ).toBeLessThanOrEqual(MAX_DRIFT_PX);
  // Each history page holds 200 events; the read takes each at most once.
  expect(reading.requests.messages, `${label}: history pages`).toBeLessThanOrEqual(
    Math.ceil(fixture.events / 200) + 2
  );
};

const login = async (
  page: Page,
  fixture: Fixture,
  viewMode: 'compact' | 'threaded' | 'classic'
) => {
  await loginWithPassword(page, { homeserver, username: fixture.username, password: PASSWORD });
  await seedRoomOverviewState({
    page,
    roomId: fixture.roomId,
    userId: fixture.userId,
    viewMode,
    filterState: createDefaultThreadFilterState(),
  });
};

const newestRoot = (fixture: Fixture) => fixture.roots[fixture.roots.length - 1] ?? '';
const oldestRoot = (fixture: Fixture) => fixture.roots[0] ?? '';

/** Opens the room in Compact, waits for every thread's card, and switches to Threads. */
const switchFromCompact = async (page: Page, fixture: Fixture, label: string) => {
  await login(page, fixture, 'compact');
  const requests = watchRequests(page, fixture.roomId);
  await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
  const cards = page.locator('[data-compact-room-view="true"] button[data-thread-root-id]');
  await expect
    .poll(() => cards.count(), { timeout: 120_000, message: 'Compact lists every thread' })
    .toBeGreaterThanOrEqual(THREADS);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${label}-compact.png` });
  }
  await toggleRoomView(page);
  await expectRoomCompact(page, false);
  await expect(page.locator(`[data-message-id="${newestRoot(fixture)}"]`)).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(1_500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label}-threads.png` });
  return requests;
};

/** Opens the room straight in a view: on a device that holds nothing, or after a reload. */
const openIn = async (
  page: Page,
  fixture: Fixture,
  viewMode: 'threaded' | 'classic',
  label: string,
  warm: boolean
) => {
  await login(page, fixture, viewMode);
  const rows = page.getByTestId('room-virtual-inner').locator('[data-message-id]').first();
  if (warm) {
    await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
    await expect(rows).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(3_000);
  }
  const requests = watchRequests(page, fixture.roomId);
  if (warm) await page.reload();
  else await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
  await expect(rows).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_500);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${label}-open.png` });
  }
  return requests;
};

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const withContext = async (
  browser: Browser,
  baseURL: string | undefined,
  engine: 'chromium' | 'webkit',
  device: Device,
  run: (context: BrowserContext) => Promise<void>
) => {
  const options = { ...(device === 'phone' ? PHONE : DESKTOP), baseURL };
  const host = engine === 'webkit' ? await launchWebKit() : undefined;
  const context = await (host ?? browser).newContext(options);
  try {
    await run(context);
  } finally {
    await context.close();
    await host?.close();
  }
};

test.describe('a room with 245 threads', () => {
  test.beforeAll(async () => {
    test.setTimeout(600_000);
    let reachable = false;
    try {
      reachable = (await fetch(`${homeserver}/_matrix/client/versions`)).ok;
    } catch {
      reachable = false;
    }
    test.skip(!reachable, `No homeserver at ${homeserver}`);
    fixture = await seedAccount();
    // eslint-disable-next-line no-console
    console.log(`[many-threads] seeded ${fixture.events} events, ${fixture.roots.length} threads`);
  });

  const cases = [
    { engine: 'chromium', device: 'desktop' },
    { engine: 'chromium', device: 'phone' },
    { engine: 'webkit', device: 'desktop' },
    { engine: 'webkit', device: 'phone' },
  ] as const;
  cases.forEach(({ engine, device }) => {
    const prefix = `${engine}-${device}`;
    test(`Threads after Compact, ${engine}, ${device}`, async ({ browser, baseURL }) => {
      test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
      test.setTimeout(600_000);
      await withContext(browser, baseURL, engine, device, async (context) => {
        const page = await context.newPage();
        const label = `${prefix}-switch`;
        const requests = await switchFromCompact(page, fixture, label);
        const held = await countHeldRoots(page, fixture.roots, label);
        await page.waitForTimeout(1_000);
        const reading = await readToOldest(
          page,
          device,
          true,
          oldestRoot(fixture),
          requests,
          label
        );
        check(reading, held);
      });
    });

    (['cold', 'warm'] as const).forEach((cache) => {
      test(`Threads opened ${cache}, ${engine}, ${device}`, async ({ browser, baseURL }) => {
        test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
        test.setTimeout(600_000);
        await withContext(browser, baseURL, engine, device, async (context) => {
          const page = await context.newPage();
          const label = `${prefix}-threads-${cache}`;
          const requests = await openIn(page, fixture, 'threaded', label, cache === 'warm');
          const held = await countHeldRoots(page, fixture.roots, label);
          await page.waitForTimeout(1_000);
          const reading = await readToOldest(
            page,
            device,
            true,
            oldestRoot(fixture),
            requests,
            label
          );
          check(reading, held);
        });
      });

      test(`Classic opened ${cache}, ${engine}, ${device}`, async ({ browser, baseURL }) => {
        test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
        test.setTimeout(900_000);
        await withContext(browser, baseURL, engine, device, async (context) => {
          const page = await context.newPage();
          const label = `${prefix}-classic-${cache}`;
          const requests = await openIn(page, fixture, 'classic', label, cache === 'warm');
          const reading = await readToOldest(
            page,
            device,
            false,
            oldestRoot(fixture),
            requests,
            label
          );
          check(reading);
        });
      });
    });
  });
});
