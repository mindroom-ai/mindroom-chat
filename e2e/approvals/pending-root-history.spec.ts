import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
  type Request,
  type Route,
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

// In the Compact view a new message opens its own thread at once, under the local ID of a message
// the server has not confirmed yet. That ID names nothing on the server, so the page must not ask
// the server about it: the thread's approval history in particular, whose failed request showed
// "Some approval history could not be loaded." under the waiting message. Once the server confirms
// the message, the approval history loads for its real ID, without an error.
// Against the disposable homeserver of a slot (scripts/e2e-slot.sh), on a phone (390 by 844,
// touch) and a desktop (1280 by 800), in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, in WebKit. Set PENDING_ROOT_APPROVAL_SHOTS=<directory> for screenshots of
// the thread while its message waits and after it is confirmed.
const PASSWORD = 'pending-root-approvals-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.PENDING_ROOT_APPROVAL_SHOTS;
const ROOM_NAME = 'Release Desk';
const FILLER_ROOMS = 24;
const HISTORY = 30;
/** How long the waiting thread gets to make the requests it should not make. */
const QUIET_MS = 3_000;
const APPROVAL_EVENT = 'io.mindroom.tool_approval';
const HISTORY_ERROR = /approval history could not be/i;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

type Account = MatrixSession & { username: string };

const registerAndLogin = (name: string): Promise<Account> =>
  registerDisposableUser(`pra_${name}_${RUN}`, PASSWORD);

type World = { reader: Account; roomId: string };

const seed = async (engine: string): Promise<World> => {
  const reader = await registerAndLogin(engine);
  const helper = await registerAgentAccount(HOMESERVER, `release_${engine}`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [helper.userId],
  });
  await joinRoom(HOMESERVER, helper.accessToken, roomId);
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index}` });
  for (let index = 1; index <= HISTORY; index += 1) {
    const fromHelper = index % 2 === 0;
    await sendRoomMessage(HOMESERVER, (fromHelper ? helper : reader).accessToken, roomId, {
      msgtype: 'm.text',
      body: fromHelper
        ? `Release item ${index}: the build passed, the changelog is drafted, and the staging deploy is waiting for the last review.`
        : `Release item ${index}: what is still open before we tag?`,
    });
  }
  return { reader, roomId };
};

const pathOf = (url: string) => decodeURIComponent(new URL(url).pathname);

/** Whether `url` sends a message to room `roomId`; browsers escape the room ID differently. */
const isSendTo = (url: URL | string, roomId: string) =>
  pathOf(url.toString()).startsWith(`/_matrix/client/v3/rooms/${roomId}/send/m.room.message/`);

/** The Matrix requests the page makes, as decoded paths with their search. */
const recordRequests = (page: Page): string[] => {
  const seen: string[] = [];
  page.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/_matrix/'))
      seen.push(`${request.method()} ${decodeURIComponent(url.pathname)}${url.search}`);
  });
  return seen;
};

/** The statuses of the page's approval history requests for `threadId`, as they answer. */
const recordApprovalHistory = (page: Page): { path: string; status: number }[] => {
  const statuses: { path: string; status: number }[] = [];
  page.on('response', (response) => {
    const path = pathOf(response.url());
    if (path.includes(`/m.thread/${APPROVAL_EVENT}`))
      statuses.push({ path, status: response.status() });
  });
  return statuses;
};

type HeldSend = { intercepted: Promise<void>; release: () => void; dispose: () => Promise<void> };

/** Holds the page's next message send to the server until `release`. */
const holdNextSend = async (page: Page, roomId: string): Promise<HeldSend> => {
  const pattern = (url: URL) => isSendTo(url, roomId);
  let handled = false;
  let onIntercept = () => undefined as void;
  const intercepted = new Promise<void>((resolve) => {
    onIntercept = resolve;
  });
  let release = () => undefined as void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handler = async (route: Route) => {
    if (handled || route.request().method() !== 'PUT') {
      await route.continue();
      return;
    }
    handled = true;
    onIntercept();
    await released;
    // The page may have closed meanwhile, after a failure.
    await route.continue().catch(() => undefined);
  };
  await page.route(pattern, handler);
  return {
    intercepted,
    release,
    dispose: () => page.unroute(pattern, handler).catch(() => undefined),
  };
};

const composer = (page: Page) => page.locator('[data-editable-name="RoomInput"]');
/** Presses the composer's Send button, as a phone has no Enter to send with. */
const pressSend = (page: Page) =>
  page.getByRole('button', { name: 'Send message', exact: true }).click();
const threadIdOf = (page: Page) => new URL(page.url()).searchParams.get('threadId') ?? '';

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const check = async (page: Page, world: World, label: string) => {
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  const requests = recordRequests(page);
  const approvalHistory = recordApprovalHistory(page);
  await page.goto(`/home/${encodeURIComponent(world.roomId)}/`);
  await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
    timeout: 60_000,
  });

  const root = `Can the ${label} release go out on Thursday?`;
  const held = await holdNextSend(page, world.roomId);
  try {
    await composer(page).click();
    await composer(page).fill(root);
    await pressSend(page);
    await Promise.race([
      held.intercepted,
      page.waitForTimeout(30_000).then(() => {
        throw new Error('The message was sent without being held');
      }),
    ]);
    // The thread opens on the message's local ID while the server has not confirmed it.
    await expect.poll(() => threadIdOf(page), { timeout: 30_000 }).toMatch(/^~/);
    const localId = threadIdOf(page);
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(QUIET_MS);
    await shot(page, `${label}-pending-root`);
    expect.soft(
      requests.filter((request) => request.includes(localId)),
      'requests naming the local ID'
    ).toEqual([]);
    await expect.soft(page.getByText(HISTORY_ERROR)).toHaveCount(0);
    await expect.soft(page.getByRole('button', { name: 'Retry history' })).toHaveCount(0);

    held.release();
    await expect.poll(() => threadIdOf(page), { timeout: 30_000 }).toMatch(/^\$/);
  } finally {
    held.release();
    await held.dispose();
  }
  // The thread's approval history loads for the confirmed ID.
  const rootId = threadIdOf(page);
  await expect
    .poll(
      () => approvalHistory.filter(({ path }) => path.includes(`/relations/${rootId}/`)),
      { timeout: 30_000 }
    )
    .toContainEqual(expect.objectContaining({ status: 200 }));
  await page.waitForTimeout(1_000);
  await expect(page.getByText(HISTORY_ERROR)).toHaveCount(0);
  await shot(page, `${label}-confirmed-root`);
  await test.info().attach(`${label}-history.json`, {
    body: JSON.stringify({ requests, approvalHistory }, null, 2),
    contentType: 'application/json',
  });
  expect.soft(
    requests.filter((request) => request.includes(`~${world.roomId}`)),
    'requests naming any local ID'
  ).toEqual([]);
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  for (const [viewport, theme, options] of [
    ['desktop', 'light', DESKTOP],
    ['phone', 'dark', PHONE],
    ['desktop', 'dark', DESKTOP],
    ['phone', 'light', PHONE],
  ] as const) {
    // WebKit sends the app's requests through its service worker, out of `page.route`'s reach.
    const context = await browser.newContext({ ...options, baseURL, serviceWorkers: 'block' });
    try {
      await context.addInitScript((themeId: string) => {
        const settings: unknown = JSON.parse(localStorage.getItem('settings') ?? '{}');
        localStorage.setItem(
          'settings',
          JSON.stringify({
            ...(typeof settings === 'object' && settings ? settings : {}),
            useSystemTheme: false,
            themeId,
          })
        );
      }, `${theme}-theme`);
      const page = await context.newPage();
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: world.reader.username,
        password: PASSWORD,
      });
      await check(page, world, `${engine}-${viewport}-${theme}`);
    } finally {
      await context.close();
    }
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

test('a thread whose message waits for the server asks nothing about its local ID (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test('a thread whose message waits for the server asks nothing about its local ID (WebKit)', async ({
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
