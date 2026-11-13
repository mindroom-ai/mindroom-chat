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

// Opening a room raises no "ResizeObserver loop completed with undelivered notifications." While a
// room opens, its rows settle (each row's estimate gives way to its height) and virtual-core reports
// that from its ResizeObserver callback. For a row above the reader it corrects the scroll position
// at once, and the ledger renders the moved rows in a microtask, before the paint, inside the
// browser's ResizeObserver loop; a correction it leaves to the ledger (a row above the newest one
// while the room fills the screen) moves the list up with a negative top margin instead. When both
// came together, that render moved the list's top and kept its height, so the scroll content, which
// the inset scrollbar and the follow-growth observer watch, shrank after they had been reported,
// and the loop ended with their observations undelivered. An agent room opens in its Threads view
// and in the Full view, four times each from a fresh page load, on a phone (390 by 844, touch) and a desktop (1280 by
// 800), in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit,
// against the disposable homeserver of a slot (scripts/e2e-slot.sh).
const PASSWORD = 'room-open-resize-loop-spec-password';
const RUN = Date.now().toString(36);
const ROOM_NAME = 'Tide Station';
const FILLER_ROOMS = 24;
const HISTORY = 24;
const OPENS = 3;
const LOOP_ERROR = /ResizeObserver loop/;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts; scrollbars show as they do for people.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

type Account = MatrixSession & { username: string };

// Accounts stay unique when a run repeats a test in the same worker.
let accounts = 0;
const register = async (name: string): Promise<Account> => {
  accounts += 1;
  const username = `rol_open_${name}_${RUN}_${accounts}`;
  return registerDisposableUser(username, PASSWORD);
};

type World = { reader: Account; roomId: string };

/** An agent room with an hour-by-hour log, a thread with an agent reply, and 24 other rooms. */
const seed = async (name: string): Promise<World> => {
  const reader = await register(`${name}_reader`);
  const member = await register(`${name}_member`);
  const agent = await registerAgentAccount(HOMESERVER, `tide_${name}`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [member.userId, agent.userId],
  });
  await joinRoom(HOMESERVER, member.accessToken, roomId);
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  for (let index = 1; index <= FILLER_ROOMS; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await createRoom(HOMESERVER, reader.accessToken, { name: `Gauge ${index}` });
  }
  for (let index = 1; index <= HISTORY; index += 1) {
    const fromMember = index % 2 === 0;
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, (fromMember ? member : reader).accessToken, roomId, {
      msgtype: 'm.text',
      body: fromMember
        ? `Reading ${index}: the gauge logged its hourly level and the battery holds at ninety percent.`
        : `Reading ${index}: anything unusual at the gauge this hour?`,
    });
  }
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Which gauges need a new battery before the spring tide on Monday?',
  });
  const thread = (replyTo: string) => ({
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: replyTo },
    },
  });
  const memberReply = await sendRoomMessage(HOMESERVER, member.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'The harbor gauge and the river mouth gauge both run low after a cold night.',
    ...thread(rootId),
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Replace the harbor gauge battery first; the river mouth one lasts until Wednesday.',
    ...thread(memberReply),
  });
  for (let index = 1; index <= 3; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Noted, thanks (${index}).`,
      ...thread(rootId),
    });
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, member.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Gauge ${index} checked: the battery reads ${90 - index * 5} percent after the night.`,
      ...thread(rootId),
    });
  }
  return { reader, roomId };
};

const navigate = async (page: Page, route: string) => {
  await page.evaluate((target) => {
    window.history.pushState(null, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
};

const roomRoute = (roomId: string) => `/home/${encodeURIComponent(roomId)}/`;

/**
 * Signs in on a fresh page (the first sync brings the room, and every row measures from its
 * estimate), opens the room at once in the view mode, lets its rows settle and returns the loop
 * errors the page saw.
 */
const openAfterSignIn = async (
  browser: Browser,
  baseURL: string | undefined,
  options: BrowserContextOptions,
  world: World,
  viewMode: 'threaded' | 'classic'
): Promise<string[]> => {
  const context = await browser.newContext({ ...options, baseURL });
  try {
    // Chromium reports the loop only to the page's error listeners, WebKit as a page error too.
    await context.addInitScript(() => {
      const loops: string[] = [];
      Object.assign(window, { resizeLoops: loops });
      window.addEventListener('error', (event) => {
        if (/ResizeObserver loop/.test(event.message)) loops.push(event.message);
      });
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    await seedRoomOverviewState({
      page,
      roomId: world.roomId,
      userId: world.reader.userId,
      viewMode,
      filterState: createDefaultThreadFilterState(),
    });
    await navigate(page, roomRoute(world.roomId));
    await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-message-id]').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const loops = await page.evaluate(
      () => (window as unknown as { resizeLoops: string[] }).resizeLoops
    );
    return [...loops, ...pageErrors.filter((message) => LOOP_ERROR.test(message))];
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
    for (const viewMode of ['threaded', 'classic'] as const) {
      for (let open = 1; open <= OPENS; open += 1) {
        // eslint-disable-next-line no-await-in-loop
        const loops = await openAfterSignIn(browser, baseURL, options, world, viewMode);
        expect(
          loops,
          `ResizeObserver loop errors in ${engine} ${viewport} ${viewMode}, open ${open}`
        ).toEqual([]);
      }
    }
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'opening a room raises no ResizeObserver loop error';

test(`${TITLE} (Chromium)`, async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test(`${TITLE} (WebKit)`, async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
