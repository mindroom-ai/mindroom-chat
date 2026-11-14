import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { getHomeserver } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  seedRoomOverviewState,
} from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';
import { CHROMIUM_WITH_SCROLLBARS } from '../helpers/disposableAccounts';

/**
 * Messages the client missed in a gappy sync still show. When more events arrive in a room than a
 * /sync response carries (20 per room), the server marks that room's timeline `limited` and sends
 * only the newest events; the client must page back from there to fill the gap. Here the reader
 * misses more than that while the room is open, while the page is in the background, while the
 * room is open and then reloads at once, while another room is open (three times, so the room
 * has three gaps), and while the client is closed; each gap holds replies to an older thread and
 * five new threads. The reader then scrolls to the room's start; every message the server holds
 * must show on the way, in the server's order, in the Classic, Threads and Compact views (the
 * older thread's replies in its thread, every thread as a Compact card), in Chromium and, when
 * the runner names it, in WebKit. Set LIMITED_SYNC_GAP_SHOTS=<directory> to save each view at its end.
 */

const PASSWORD = 'limited-sync-gap-1';
const SHOTS = process.env.LIMITED_SYNC_GAP_SHOTS;
/** A directory for each test's console log, with the timeline's debug lines on. */
const LOGS = process.env.LIMITED_SYNC_GAP_LOGS;
const homeserver = getHomeserver();
const DESKTOP = { viewport: { width: 1280, height: 800 } };
/**
 * Room messages before the first gap. A first visit saves a room's newest 200 events for offline
 * reading, which uses up what the gap fill may fetch in the background on a metered connection
 * (a browser that does not report Wi-Fi), so the view must page across the gap itself.
 */
const BEFORE_MESSAGES = 200;
/** Room messages the reader misses in each gap, with thread replies between them. */
const GAP_MESSAGES = 60;
const GAP_REPLIES = 30;
/** Threads that start and get a reply inside each gap. */
const GAP_THREADS = 5;

// Deterministic text of realistic lengths.
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
const note = (label: string) => ({
  msgtype: 'm.text',
  body: `${label}: ${Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
    sentence(6, 18)
  ).join(' ')}`,
});
const reply = (rootId: string, label: string) => ({
  ...note(label),
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

type Account = { userId: string; accessToken: string; username: string };

const register = async (prefix: string): Promise<Account> => {
  const username = `${prefix}${randomUUID().slice(0, 8)}`;
  const account = await matrixFetch<{ access_token: string; user_id: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  return { userId: account.user_id, accessToken: account.access_token, username };
};

const send = async (token: string, roomId: string, content: Record<string, unknown>) =>
  (
    await matrixFetch<{ event_id: string }>(
      homeserver,
      `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${randomUUID()}`,
      { method: 'PUT', accessToken: token, body: JSON.stringify(content) }
    )
  ).event_id;

type RawEvent = {
  event_id: string;
  type: string;
  origin_server_ts: number;
  content?: { 'm.relates_to'?: { rel_type?: string; event_id?: string } };
};

/**
 * When each listed event was sent: the order of two sent in the same millisecond is the server's
 * alone.
 */
const sentAt = new Map<string, number>();

/** Every event of the room, newest first, as the server has them. */
const listRoomEvents = async (token: string, roomId: string): Promise<RawEvent[]> => {
  const events: RawEvent[] = [];
  let from = '';
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const page = await matrixFetch<{ chunk: RawEvent[]; end?: string }>(
      homeserver,
      `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=500${
        from ? `&from=${encodeURIComponent(from)}` : ''
      }`,
      { accessToken: token }
    );
    events.push(...page.chunk);
    page.chunk.forEach((event) => sentAt.set(event.event_id, event.origin_server_ts));
    if (!page.end || page.chunk.length === 0) break;
    from = page.end;
  }
  return events;
};

/**
 * The room's own messages (no thread replies, no edits), oldest first, as the server has them;
 * with `newestEvents`, only those among the room's newest that many events.
 */
const listRoomMessages = async (
  token: string,
  roomId: string,
  newestEvents = Number.POSITIVE_INFINITY
): Promise<string[]> =>
  (await listRoomEvents(token, roomId))
    .slice(0, newestEvents)
    .filter((event) => {
      const relation = event.content?.['m.relates_to']?.rel_type;
      return event.type === 'm.room.message' && relation !== 'm.thread' && relation !== 'm.replace';
    })
    .map((event) => event.event_id)
    .reverse();

/** The roots of the room's threads, oldest first, as the server has them. */
const listThreadRoots = async (token: string, roomId: string) => {
  const events = await listRoomEvents(token, roomId);
  const roots = new Set(
    events.flatMap((event) => {
      const relation = event.content?.['m.relates_to'];
      return relation?.rel_type === 'm.thread' && relation.event_id ? [relation.event_id] : [];
    })
  );
  return events
    .map((event) => event.event_id)
    .filter((eventId) => roots.has(eventId))
    .reverse();
};

/** The thread's replies, oldest first, as the server has them. */
const listThreadReplies = async (token: string, roomId: string, rootId: string) =>
  (await listRoomEvents(token, roomId))
    .filter((event) => {
      const relation = event.content?.['m.relates_to'];
      return relation?.rel_type === 'm.thread' && relation.event_id === rootId;
    })
    .map((event) => event.event_id)
    .reverse();

type Fixture = { reader: Account; sender: Account; otherRoomId: string };

/** The reader has 25 other rooms, as an account has; the sender writes into the gap rooms. */
const seedAccounts = async (): Promise<Fixture> => {
  const [reader, sender] = await Promise.all([register('gapreader'), register('gapsender')]);
  const otherRooms = await Promise.all(
    Array.from({ length: 25 }, async (_, index) => {
      const roomId = await createPrivateRoom(homeserver, reader.accessToken, {
        name: `Project ${index + 1}`,
        topic: 'Another room of the account',
      });
      await send(reader.accessToken, roomId, note(`Project ${index + 1}`));
      return roomId;
    })
  );
  return { reader, sender, otherRoomId: otherRooms[0] ?? '' };
};

type GapRoom = { roomId: string; rootId: string; label: string };

/** A shared room with a thread and BEFORE_MESSAGES messages before any gap. */
const createGapRoom = async (fixture: Fixture, label: string): Promise<GapRoom> => {
  const roomId = await createPrivateRoom(homeserver, fixture.sender.accessToken, {
    name: `Gap ${label}`,
    topic: 'Messages the reader misses in a gappy sync',
    invite: [fixture.reader.userId],
  });
  await joinRoom(homeserver, fixture.reader.accessToken, roomId);
  const rootId = await send(fixture.sender.accessToken, roomId, note(`${label} thread root`));
  for (let index = 1; index <= BEFORE_MESSAGES; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send(fixture.sender.accessToken, roomId, note(`${label} before ${index}`));
  }
  return { roomId, rootId, label };
};

/** More messages than one sync carries, with thread replies between them. */
const sendGap = async (fixture: Fixture, room: GapRoom, round: number) => {
  for (let index = 1; index <= GAP_MESSAGES; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send(
      fixture.sender.accessToken,
      room.roomId,
      note(`${room.label} gap ${round}.${index}`)
    );
    if (index % 2 === 0 && index / 2 <= GAP_REPLIES)
      // eslint-disable-next-line no-await-in-loop
      await send(
        fixture.sender.accessToken,
        room.roomId,
        reply(room.rootId, `${room.label} reply ${round}.${index / 2}`)
      );
    if (index % (GAP_MESSAGES / GAP_THREADS) === 0) {
      const thread = index / (GAP_MESSAGES / GAP_THREADS);
      // eslint-disable-next-line no-await-in-loop
      const newRootId = await send(
        fixture.sender.accessToken,
        room.roomId,
        note(`${room.label} gap thread ${round}.${thread}`)
      );
      // eslint-disable-next-line no-await-in-loop
      await send(
        fixture.sender.accessToken,
        room.roomId,
        reply(newRootId, `${room.label} gap thread reply ${round}.${thread}`)
      );
    }
  }
};

/** Resolves once a /sync response marks the room's timeline as limited (a gap). */
const waitForLimitedSync = (page: Page, roomId: string) =>
  page.waitForResponse(
    async (response) => {
      if (!response.url().includes('/sync?') || response.status() !== 200) return false;
      const data = (await response.json().catch(() => undefined)) as
        | { rooms?: { join?: Record<string, { timeline?: { limited?: boolean } }> } }
        | undefined;
      return data?.rooms?.join?.[roomId]?.timeline?.limited === true;
    },
    { timeout: 120_000 }
  );

/** The reader misses a gap while the client is offline, then comes back online. */
const missGapOffline = async (
  page: Page,
  context: BrowserContext,
  fixture: Fixture,
  room: GapRoom,
  round: number
) => {
  await context.setOffline(true);
  await sendGap(fixture, room, round);
  const limited = waitForLimitedSync(page, room.roomId);
  await context.setOffline(false);
  await limited;
};

/** Moves the loaded client to a room, as a link inside the app would. */
const showRoom = async (page: Page, roomId: string) => {
  await page.evaluate((url) => {
    window.history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/home/${encodeURIComponent(roomId)}`);
};

type ViewMode = 'classic' | 'threaded' | 'compact';

/** Signs in, opens `roomId`, and shows it and each of `otherRoomIds` in `viewMode`. */
const openClient = async (
  page: Page,
  fixture: Fixture,
  roomId: string,
  viewMode: ViewMode,
  otherRoomIds: string[] = []
) => {
  await loginWithPassword(page, {
    homeserver,
    username: fixture.reader.username,
    password: PASSWORD,
  });
  for (const shownRoomId of [roomId, ...otherRoomIds]) {
    // eslint-disable-next-line no-await-in-loop
    await seedRoomOverviewState({
      page,
      roomId: shownRoomId,
      userId: fixture.reader.userId,
      viewMode,
      filterState: createDefaultThreadFilterState(),
    });
  }
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
};

/** Ids the view shows for the room's messages: timeline rows, or cards in the Compact view. */
const ROW_SELECTOR: Record<ViewMode, string> = {
  classic: '[data-message-id]',
  threaded: '[data-message-id]',
  compact: '[data-thread-root-id]',
};
const rowId = (viewMode: ViewMode) =>
  viewMode === 'compact' ? 'data-thread-root-id' : 'data-message-id';

type WatchWindow = Window & { gapWatch?: { seen: string[]; stop: () => void } };

/** The scroll area around the view's rows. */
const findScroller = (page: Page, viewMode: ViewMode) =>
  page
    .locator(ROW_SELECTOR[viewMode])
    .first()
    .evaluateHandle((row) => {
      let node = row.parentElement;
      while (node && !['auto', 'scroll'].includes(getComputedStyle(node).overflowY))
        node = node.parentElement;
      if (!node) throw new Error('The view has no scroll area');
      return node;
    });

/** Records, on every frame, the room's messages the view renders. */
const startWatch = (page: Page, viewMode: ViewMode) =>
  page.evaluate(
    ({ selector, attribute }) => {
      const seen = new Set<string>();
      let running = true;
      const tick = () => {
        if (!running) return;
        document.querySelectorAll<HTMLElement>(selector).forEach((row) => {
          const id = row.getAttribute(attribute);
          if (id) seen.add(id);
        });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      (window as WatchWindow).gapWatch = {
        get seen() {
          return [...seen];
        },
        stop: () => {
          running = false;
        },
      };
    },
    { selector: ROW_SELECTOR[viewMode], attribute: rowId(viewMode) }
  );

const readSeen = (page: Page) => page.evaluate(() => (window as WatchWindow).gapWatch?.seen ?? []);

/** Order of the room's messages in the view, top to bottom, among those mounted now. */
const readOrder = (page: Page, viewMode: ViewMode) =>
  page.evaluate(
    ({ selector, attribute }) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector))
        .map((row) => ({
          id: row.getAttribute(attribute) ?? '',
          rect: row.getBoundingClientRect(),
        }))
        // Rows laid out in the window; the virtual list keeps others mounted out of sight.
        .filter(({ rect }) => rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight)
        .sort((a, b) => a.rect.top - b.rect.top)
        .map(({ id }) => id),
    { selector: ROW_SELECTOR[viewMode], attribute: rowId(viewMode) }
  );

/**
 * Scrolls like a reader, a flick of eight wheel notches then a glance, toward older messages until
 * every message showed or nothing new shows for fifteen flicks. The Compact view lists the newest
 * card first, so its reader scrolls down. Where the wheel does not reach the list (Playwright's
 * WebKit at times), the flick scrolls the list by the same distance.
 */
const readWholeRoom = async (page: Page, viewMode: ViewMode, expected: string[]) => {
  const scroller = await findScroller(page, viewMode);
  const box = await scroller.boundingBox();
  if (!box) throw new Error('The view is not laid out');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await startWatch(page, viewMode);
  const direction = viewMode === 'compact' ? 1 : -1;
  const orders: string[][] = [];
  let seenCount = 0;
  let idle = 0;
  while (idle < 15) {
    // eslint-disable-next-line no-await-in-loop
    const before = await scroller.evaluate((view) => view.scrollTop);
    for (let notch = 0; notch < 8; notch += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, direction * 320);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(40);
    }
    // eslint-disable-next-line no-await-in-loop
    if ((await scroller.evaluate((view) => view.scrollTop)) === before)
      // eslint-disable-next-line no-await-in-loop
      await scroller.evaluate((view, top) => view.scrollBy({ top }), direction * 2560);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(300);
    // eslint-disable-next-line no-await-in-loop
    orders.push(await readOrder(page, viewMode));
    // eslint-disable-next-line no-await-in-loop
    const seen = await readSeen(page);
    if (expected.every((id) => seen.includes(id))) break;
    idle = seen.length === seenCount ? idle + 1 : 0;
    seenCount = seen.length;
  }
  const seen = new Set(await readSeen(page));
  await page.evaluate(() => (window as WatchWindow).gapWatch?.stop());
  return { seen, orders };
};

/** Reads the whole view: every message of `expected` shows on the way, in the server's order. */
const checkShown = async (page: Page, viewMode: ViewMode, expected: string[], label: string) => {
  const newest = expected[expected.length - 1] ?? '';
  await expect(
    page.locator(`[${rowId(viewMode)}="${newest}"]`),
    `${label}: the newest message shows`
  ).toBeVisible({ timeout: 60_000 });
  // The reader reads for a moment before scrolling.
  await page.waitForTimeout(1_500);
  const { seen, orders } = await readWholeRoom(page, viewMode, expected);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${label}.png` });
  }
  const missing = expected.flatMap((id, index) =>
    seen.has(id) ? [] : [`${index + 1} of ${expected.length}: ${id}`]
  );
  expect(missing, `${label}: messages the server has that never showed`).toEqual([]);
  // Every glance at the timeline shows the room's messages in the server's order. Compact cards
  // follow each thread's latest activity instead.
  if (viewMode === 'compact') return;
  const position = new Map(expected.map((id, index) => [id, index]));
  // Two messages sent in the same millisecond may show either way: the cache orders them by ID.
  const sorted = (ids: string[]) => {
    const known = ids.filter((id) => position.has(id));
    return known.every((id, index) => {
      const above = known[index - 1];
      return (
        above === undefined ||
        (position.get(id) ?? 0) > (position.get(above) ?? 0) ||
        sentAt.get(id) === sentAt.get(above)
      );
    });
  };
  expect(
    orders
      .filter((order) => !sorted(order))
      .map((order) => order.flatMap((id) => (position.has(id) ? [position.get(id)] : []))),
    `${label}: glances with messages out of order (their places in the server's order)`
  ).toEqual([]);
};

const checkRoom = async (
  page: Page,
  fixture: Fixture,
  room: GapRoom,
  viewMode: ViewMode,
  label: string
) => {
  // The Compact view has no scroll paginator: it shows every thread, those that started in a gap
  // too, and a card for each message without replies among the room's newest 200 events
  // (COMPACT_COVERAGE_TARGET_EVENTS).
  const token = fixture.sender.accessToken;
  const expected =
    viewMode === 'compact'
      ? [
          ...new Set([
            ...(await listThreadRoots(token, room.roomId)),
            ...(await listRoomMessages(token, room.roomId, 200)),
          ]),
        ]
      : await listRoomMessages(token, room.roomId);
  await checkShown(page, viewMode, expected, label);
  if (viewMode !== 'threaded') return;
  // The thread's replies the gap held show in the thread too.
  const replies = await listThreadReplies(fixture.sender.accessToken, room.roomId, room.rootId);
  // The reader has scrolled to the room's start, where the thread's root shows its replies.
  const repliesButton = page.locator(`[data-thread-root-id="${room.rootId}"]`).first();
  await repliesButton.scrollIntoViewIfNeeded();
  await repliesButton.click();
  await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 60_000 });
  await checkShown(page, 'threaded', replies, `${label}-thread`);
};

type Scenario = 'open' | 'background' | 'reload' | 'elsewhere' | 'closed';

/** Signs in with the gap room open and waits until its newest message shows. */
const openGapRoom = async (page: Page, fixture: Fixture, room: GapRoom, viewMode: ViewMode) => {
  await openClient(page, fixture, room.roomId, viewMode);
  await expect(
    page.getByText(`${room.label} before ${BEFORE_MESSAGES}:`, { exact: false }).first()
  ).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_000);
};

/** Tells the page it is hidden (another tab or app in front of it) or shown again. */
const setPageHidden = (page: Page, hidden: boolean) =>
  page.evaluate((isHidden) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (isHidden ? 'hidden' : 'visible'),
    });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => isHidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

const runScenario = async (
  context: BrowserContext,
  fixture: Fixture,
  scenario: Scenario,
  viewMode: ViewMode,
  label: string
) => {
  const room = await createGapRoom(fixture, label);
  const page = await context.newPage();
  if (LOGS) {
    mkdirSync(LOGS, { recursive: true });
    const log = `${LOGS}/${label}.log`;
    writeFileSync(log, '');
    page.on('console', (message) =>
      appendFileSync(log, `${new Date().toISOString()} ${message.type()} ${message.text()}\n`)
    );
    await page.addInitScript(() => localStorage.setItem('mindroom.debug.timeline', '1'));
  }
  if (scenario === 'elsewhere') {
    // Another room is open while the reader misses three gaps, then the reader opens this one.
    await openClient(page, fixture, fixture.otherRoomId, viewMode, [room.roomId]);
    await expect(page.getByText('Project 1:', { exact: false }).first()).toBeVisible({
      timeout: 60_000,
    });
    for (let round = 1; round <= 3; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await missGapOffline(page, context, fixture, room, round);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(500);
    }
    await showRoom(page, room.roomId);
  } else if (scenario === 'closed') {
    // The client is closed while the gap arrives, and the reader comes back to the room.
    await openGapRoom(page, fixture, room, viewMode);
    await page.waitForTimeout(1_000);
    await page.goto('about:blank');
    await sendGap(fixture, room, 1);
    await page.goto(`/home/${encodeURIComponent(room.roomId)}`);
  } else {
    // The room is open on screen while the reader misses the gap: in front, behind another tab or
    // app, or just before the page reloads.
    await openGapRoom(page, fixture, room, viewMode);
    if (scenario === 'background') await setPageHidden(page, true);
    await missGapOffline(page, context, fixture, room, 1);
    if (scenario === 'background') {
      await page.waitForTimeout(2_000);
      await setPageHidden(page, false);
    }
    if (scenario === 'reload') await page.reload();
  }
  await checkRoom(page, fixture, room, viewMode, label);
};

let fixture: Fixture;

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

test.describe('messages missed in a gappy sync show', () => {
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    let reachable = false;
    try {
      reachable = (await fetch(`${homeserver}/_matrix/client/versions`)).ok;
    } catch {
      reachable = false;
    }
    test.skip(!reachable, `No homeserver at ${homeserver}`);
    fixture = await seedAccounts();
  });

  (['chromium', 'webkit'] as const).forEach((engine) => {
    (['open', 'background', 'reload', 'elsewhere', 'closed'] as const).forEach((scenario) => {
      (['classic', 'threaded', 'compact'] as const).forEach((viewMode) => {
        const label = `${scenario}-${viewMode}-${engine}`;
        test(`${scenario}, ${viewMode} view, ${engine}`, async ({ browser, baseURL }) => {
          test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
          test.setTimeout(300_000);
          const host = engine === 'webkit' ? await launchWebKit() : undefined;
          const context = await (host ?? browser).newContext({ ...DESKTOP, baseURL });
          try {
            await runScenario(context, fixture, scenario, viewMode, label);
          } finally {
            await context.close();
            await host?.close();
          }
        });
      });
    });
  });
});
