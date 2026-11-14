import { mkdirSync, writeFileSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
  type Route,
} from '@playwright/test';
import { getHomeserver } from '../env';
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
import { CHROMIUM_WITH_SCROLLBARS } from '../helpers/disposableAccounts';

// A room's thread list is read page by page, 30 threads a page, newest activity first. A busy room
// in a live test stopped reading its list with a page token left and never went on, so the cached
// summaries of its older threads were never refreshed. Here a new device opens a room with 150
// threads (5 pages) in the Compact view while its third page fails:
// - the server answers it once with a 502;
// - the homeserver cannot be reached for a while (its /sync answers too), with no browser `online`
//   event: the page knows only that its sync got through again;
// - the reader leaves the room while the page loads and comes back.
// Each time the read must go on from that page to the list's last page by itself, without asking
// for an earlier page again and without two pages of the list at a time, and the oldest thread
// gets its card. Set THREAD_RESUME_LOG=<directory> to save each run's /threads requests.
const THREADS = 150;
const PAGES = THREADS / 30;
const PASSWORD = 'thread-list-resume-spec-password';
const RUN = Date.now().toString(36);
const LOG_DIR = process.env.THREAD_RESUME_LOG;
/** How long the homeserver stays out of reach. */
const OUTAGE_MS = 8_000;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

test.use({
  serviceWorkers: 'block',
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});
test.describe.configure({ mode: 'serial' });

const TOPICS = [
  'Draft the onboarding checklist for the new support hires',
  'Compare the two vendor quotes for the storage upgrade',
  'Plan the agenda for the quarterly planning review',
  'Collect feedback on the revised pricing page copy',
  'Summarize the incident timeline from last night’s outage',
];
const REPLIES = [
  'I went through it this morning; two items still need an owner before Friday.',
  'Looks good to me. I left a few comments on the wording in the second section.',
  'The numbers check out, but the delivery estimate seems optimistic to me.',
];

type Account = MatrixSession & { username: string };
type Seed = {
  reader: Account;
  writer: Account;
  roomId: string;
  otherRoomId: string;
  roots: string[];
};

const register = async (homeserver: string, name: string): Promise<Account> => {
  const username = `tlr_${name}_${RUN}`;
  await matrixFetch(homeserver, '/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  return { ...(await loginToMatrix(homeserver, username, PASSWORD)), username };
};

/**
 * A writer's room with an agent and 150 threads, each with one reply from the agent or the writer,
 * thread 0 the oldest. The reader also has 25 other rooms.
 */
const seed = async (): Promise<Seed> => {
  const homeserver = getHomeserver();
  const reader = await register(homeserver, 'reader');
  const writer = await register(homeserver, 'writer');
  const agent = await registerAgentAccount(homeserver, 'planner');
  const roomId = await createRoom(homeserver, writer.accessToken, {
    name: 'Operations planning',
    invite: [reader.userId, agent.userId],
  });
  await joinRoom(homeserver, reader.accessToken, roomId);
  await joinRoom(homeserver, agent.accessToken, roomId);
  const otherRooms = await Promise.all(
    Array.from({ length: 25 }, async (_, index) => {
      const otherRoom = await createRoom(homeserver, reader.accessToken, {
        name: `Project room ${index + 1}`,
      });
      await sendRoomMessage(homeserver, reader.accessToken, otherRoom, {
        msgtype: 'm.text',
        body: `Notes for project ${index + 1}: the next review is on Thursday.`,
      });
      return otherRoom;
    })
  );

  const roots: string[] = [];
  for (let index = 0; index < THREADS; index += 1) {
    // One at a time, so thread 0 is the oldest by activity.
    // eslint-disable-next-line no-await-in-loop
    const root = await sendRoomMessage(homeserver, writer.accessToken, roomId, {
      msgtype: 'm.text',
      body: `${TOPICS[index % TOPICS.length]} (thread ${index})`,
    });
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(homeserver, (index % 2 === 0 ? agent : writer).accessToken, roomId, {
      msgtype: 'm.text',
      body: `${REPLIES[index % REPLIES.length]} (reply in thread ${index})`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: root,
        is_falling_back: true,
        'm.in_reply_to': { event_id: root },
      },
    });
    roots.push(root);
  }
  return { reader, writer, roomId, otherRoomId: otherRooms[0] ?? '', roots };
};

let seeded: Promise<Seed> | undefined;

/** One /threads request of the room's whole list: its token, what came back, and when. */
type ListCall = {
  from: string | null;
  outcome: 'page' | 'last page' | 'aborted' | number;
  at: number;
  /** Other requests of the list still open when this one was made. */
  open: number;
};

type Fault = {
  /**
   * May answer the list's `index`th paged request (the first page is not one) itself, and then
   * says how; every try of a page is a paged request.
   */
  page?: (route: Route, index: number) => Promise<'aborted' | number | undefined>;
  /** Answers any other homeserver request itself, or not. */
  other?: (route: Route, url: URL) => Promise<boolean>;
};

/** Records the room's `include=all` /threads requests and lets `fault` answer some of them. */
const watchList = async (page: Page, roomId: string, fault: Fault) => {
  const calls: ListCall[] = [];
  const homeserver = new URL(getHomeserver()).origin;
  let open = 0;
  let paged = 0;
  const startedAt = Date.now();
  await page.route(
    (url) => url.origin === homeserver,
    async (route) => {
      const url = new URL(route.request().url());
      const isList =
        decodeURIComponent(url.pathname).endsWith(`/rooms/${roomId}/threads`) &&
        url.searchParams.get('include') === 'all';
      if (!isList) {
        if (!(await fault.other?.(route, url))) await route.fallback();
        return;
      }
      const from = url.searchParams.get('from');
      const call: ListCall = { from, outcome: 'aborted', at: Date.now() - startedAt, open };
      calls.push(call);
      open += 1;
      try {
        const index = from === null ? -1 : paged;
        if (from !== null) paged += 1;
        const faulted = await fault.page?.(route, index);
        if (faulted !== undefined) {
          call.outcome = faulted;
          return;
        }
        const response = await route.fetch();
        const body = (await response.json()) as { next_batch?: string };
        if (response.status() !== 200) call.outcome = response.status();
        else call.outcome = body.next_batch ? 'page' : 'last page';
        await route.fulfill({ response, json: body });
      } catch {
        // The page closed while the request was open.
      } finally {
        open -= 1;
      }
    }
  );
  return calls;
};

const describeCalls = (calls: ListCall[]) =>
  calls
    .map(
      ({ from, outcome, at, open }) =>
        `${from ?? 'first'}@${at}ms:${outcome}${open ? ` (open ${open})` : ''}`
    )
    .join(', ');

/** Opens the room in the Compact view on a new device. */
const openRoom = async (page: Page, world: Seed) => {
  await loginWithPassword(page, {
    homeserver: getHomeserver(),
    username: world.reader.username,
    password: PASSWORD,
  });
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'compact',
    filterState: createHiddenOverviewFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(world.roomId)}/`);
};

/** Opens a room the way the app does, without loading the page again. */
const goToRoom = (page: Page, roomId: string) =>
  page.evaluate((id) => {
    window.history.pushState(null, '', `/home/${encodeURIComponent(id)}/`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, roomId);

/**
 * The list reached its last page, each page's token was asked for until it answered and never
 * again after that, one request at a time, and the oldest thread has its card.
 */
const expectWholeList = async (page: Page, world: Seed, calls: ListCall[], name: string) => {
  // The poll shows the requests so far when it fails.
  await expect
    .poll(() => describeCalls(calls), { timeout: 45_000, message: `${name}: the list's last page` })
    .toContain('last page');
  // Nothing more after the last page.
  await page.waitForTimeout(3_000);
  const answered = calls.filter(({ outcome }) => outcome === 'page' || outcome === 'last page');
  expect(answered.map(({ from }) => from).filter((from) => from === null)).toHaveLength(1);
  expect(answered).toHaveLength(PAGES);
  expect(new Set(answered.map(({ from }) => from)).size).toBe(PAGES);
  // A token is asked for again only after it failed, never after its page arrived.
  answered.forEach(({ from }) => {
    expect(['page', 'last page']).toContain(
      calls.filter((call) => call.from === from).at(-1)?.outcome
    );
  });
  expect(calls.filter(({ from }) => from !== null).map(({ open }) => open)).toEqual(
    calls.filter(({ from }) => from !== null).map(() => 0)
  );

  const oldest = page.locator(`[data-compact-room-view] [data-thread-root-id="${world.roots[0]}"]`);
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          const view = document.querySelector('[data-compact-room-view]');
          if (view) view.scrollTop = view.scrollHeight;
        });
        return oldest.count();
      },
      { timeout: 20_000 }
    )
    .toBeGreaterThan(0);
  if (LOG_DIR) writeFileSync(`${LOG_DIR}/${name}.txt`, `${describeCalls(calls)}\n`);
  test.info().annotations.push({ type: name, description: describeCalls(calls) });
};

/** The third page fails once with a 502. */
const checkServerError = async (page: Page, name: string) => {
  seeded ??= seed();
  const world = await seeded;
  const calls = await watchList(page, world.roomId, {
    page: async (route, index) => {
      if (index !== 1) return undefined;
      await route.fulfill({
        status: 502,
        json: { errcode: 'M_UNKNOWN', error: 'Bad gateway' },
      });
      return 502;
    },
  });
  await openRoom(page, world);
  await expectWholeList(page, world, calls, `${name}-server-error`);
};

/** The homeserver is out of reach from the third page on, /sync included, for a while. */
const checkOutage = async (page: Page, name: string) => {
  seeded ??= seed();
  const world = await seeded;
  let down = false;
  let failedSyncs = 0;
  const homeserver = getHomeserver();
  const calls = await watchList(page, world.roomId, {
    page: async (route, index) => {
      if (index === 1) {
        down = true;
        // Another message ends the open /sync long poll, inside the outage.
        void sendRoomMessage(homeserver, world.writer.accessToken, world.roomId, {
          msgtype: 'm.text',
          body: 'One more note before the review.',
        });
        setTimeout(() => {
          down = false;
        }, OUTAGE_MS);
      }
      if (!down) return undefined;
      await route.abort('internetdisconnected');
      return 'aborted';
    },
    other: async (route, url) => {
      if (url.pathname.endsWith('/sync') && !down) {
        // The long poll may take as long as the server's own 30 s timeout; its answer is lost
        // when the outage started meanwhile.
        const response = await route.fetch({ timeout: 0 }).catch(() => undefined);
        if (response && !down) {
          await route.fulfill({ response }).catch(() => undefined);
          return true;
        }
      }
      if (!down) return false;
      if (url.pathname.endsWith('/sync')) failedSyncs += 1;
      await route.abort('internetdisconnected');
      return true;
    },
  });
  await openRoom(page, world);
  await expect
    .poll(() => failedSyncs, { timeout: 30_000, message: 'a failed /sync' })
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await expectWholeList(page, world, calls, `${name}-outage`);
};

/** The reader leaves the room while its third page loads, and comes back a little later. */
const checkLeaveAndReturn = async (page: Page, name: string) => {
  seeded ??= seed();
  const world = await seeded;
  let releasePage: (() => void) | undefined;
  const calls = await watchList(page, world.roomId, {
    page: async (_route, index) => {
      if (index === 1) {
        await new Promise<void>((resolve) => {
          releasePage = resolve;
        });
      }
      return undefined;
    },
  });
  await openRoom(page, world);
  await expect.poll(() => !!releasePage, { timeout: 30_000 }).toBe(true);
  await goToRoom(page, world.otherRoomId);
  await expect(page.getByRole('heading', { name: 'Project room 1' }).first()).toBeVisible();
  releasePage?.();
  // Nobody shows the list now, so nothing reads on.
  await page.waitForTimeout(3_000);
  const whileAway = calls.length;
  expect(calls.at(-1)?.outcome, describeCalls(calls)).toBe('page');
  await goToRoom(page, world.roomId);
  await expectWholeList(page, world, calls, `${name}-leave-and-return`);
  expect(whileAway, describeCalls(calls)).toBe(3);
};

const inContext = async (
  browser: Browser,
  options: BrowserContextOptions,
  run: (page: Page) => Promise<void>
) => {
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
  try {
    await run(await context.newPage());
  } finally {
    await context.close();
  }
};

/** Runs every case, also after one failed, and then fails with each failure. */
const checkAll = async (browser: Browser, options: BrowserContextOptions, name: string) => {
  const failures: string[] = [];
  for (const check of [checkServerError, checkOutage, checkLeaveAndReturn]) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await inContext(browser, options, (page) => check(page, name));
    } catch (error) {
      failures.push(`${check.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  expect(failures).toEqual([]);
};

test.beforeAll(() => {
  if (LOG_DIR) mkdirSync(LOG_DIR, { recursive: true });
});

test('a room’s thread list goes on from a page that failed (Chromium, desktop)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(420_000);
  await checkAll(browser, { ...DESKTOP, baseURL, colorScheme: 'light' }, 'chromium-desktop');
});

test('a room’s thread list goes on from a page that failed (Chromium, phone)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(420_000);
  await checkAll(browser, { ...PHONE, baseURL, colorScheme: 'dark' }, 'chromium-phone');
});

for (const [form, options] of [
  ['phone', { ...PHONE, colorScheme: 'light' }],
  ['desktop', { ...DESKTOP, colorScheme: 'dark' }],
] as const) {
  test(`a room’s thread list goes on from a page that failed (WebKit, ${form})`, async ({
    baseURL,
  }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(420_000);
    const browser = await launchWebKit();
    try {
      await checkAll(browser, { ...options, baseURL }, `webkit-${form}`);
    } finally {
      await browser.close();
    }
  });
}
