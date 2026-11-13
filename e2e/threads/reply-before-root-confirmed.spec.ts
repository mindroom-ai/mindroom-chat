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

// In the Compact view a new message opens its own thread at once, while the server has not yet
// confirmed it. Until then the thread's root has only its local ID, which no reply can point at.
// The composer stays usable meanwhile: text typed there is kept when the root gets its own ID, and
// a reply sent before that waits until it has, then goes out in the thread, after its root.
// Against the disposable homeserver of a slot (scripts/e2e-slot.sh), on a phone (390 by 844,
// touch) and a desktop (1280 by 800), in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, in WebKit. Set PENDING_ROOT_SHOTS=<directory> for screenshots of the
// thread while its root waits for the server.
const PASSWORD = 'reply-before-root-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.PENDING_ROOT_SHOTS;
const ROOM_NAME = 'Release Desk';
const FILLER_ROOMS = 24;
const HISTORY = 30;
/** How long a send that must wait gets to go out anyway. */
const QUIET_MS = 2_000;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

type Account = MatrixSession & { username: string };

const registerAndLogin = async (name: string): Promise<Account> => {
  const username = `rbr_${name}_${RUN}`;
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

/** Whether `url` sends a message to room `roomId`; browsers escape the room ID differently. */
const isSendTo = (url: URL | string, roomId: string) =>
  decodeURIComponent(new URL(url).pathname).startsWith(
    `/_matrix/client/v3/rooms/${roomId}/send/m.room.message/`
  );

/** The message sends the page makes in the room, in order, by body. */
const recordSends = (page: Page, roomId: string): string[] => {
  const bodies: string[] = [];
  page.on('request', (request: Request) => {
    if (request.method() !== 'PUT' || !isSendTo(request.url(), roomId)) return;
    const { body } = (request.postDataJSON() ?? {}) as { body?: string };
    bodies.push(body ?? '');
  });
  return bodies;
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

type ThreadReply = {
  body: string;
  ts: number;
  relation?: { event_id?: string; 'm.in_reply_to'?: { event_id?: string } };
};

/** The thread's replies as the server has them. */
const serverReplies = async (world: World, rootId: string): Promise<ThreadReply[]> => {
  const { chunk } = await matrixFetch<{
    chunk: {
      origin_server_ts: number;
      content: { body?: string; 'm.relates_to'?: ThreadReply['relation'] };
    }[];
  }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(world.roomId)}/relations/${encodeURIComponent(
      rootId
    )}/m.thread?limit=20`,
    { accessToken: world.reader.accessToken, apiVersion: 'v1' }
  );
  return chunk.map((event) => ({
    body: event.content.body ?? '',
    ts: event.origin_server_ts,
    relation: event.content['m.relates_to'],
  }));
};

const serverRootTs = async (world: World, rootId: string) =>
  (
    await matrixFetch<{ origin_server_ts: number }>(
      HOMESERVER,
      `/rooms/${encodeURIComponent(world.roomId)}/event/${encodeURIComponent(rootId)}`,
      { accessToken: world.reader.accessToken }
    )
  ).origin_server_ts;

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** Sends `root` from the room's composer and holds it: its thread opens on the local ID. */
const startThread = async (page: Page, world: World, root: string): Promise<HeldSend> => {
  const held = await holdNextSend(page, world.roomId);
  await composer(page).click();
  await composer(page).fill(root);
  await pressSend(page);
  await Promise.race([
    held.intercepted,
    page.waitForTimeout(30_000).then(() => {
      throw new Error('The root was sent without being held');
    }),
  ]);
  await expect.poll(() => threadIdOf(page), { timeout: 30_000 }).toMatch(/^~/);
  await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
  return held;
};

/** Checks that `reply` reached the server in the thread of `root`, after it, pointing at it. */
const expectReplyAfterRoot = async (world: World, rootId: string, reply: string) => {
  const replies = await serverReplies(world, rootId);
  const sent = replies.find((candidate) => candidate.body === reply);
  expect(sent, `${reply} in the thread`).toBeDefined();
  expect(sent?.relation?.event_id).toBe(rootId);
  expect(sent?.relation?.['m.in_reply_to']?.event_id).toBe(rootId);
  expect(sent!.ts).toBeGreaterThanOrEqual(await serverRootTs(world, rootId));
};

const check = async (page: Page, world: World, label: string) => {
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  const sends = recordSends(page, world.roomId);
  await page.goto(`/home/${encodeURIComponent(world.roomId)}/`);
  await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
    timeout: 60_000,
  });

  // (a) Text typed while the root waits is kept when the root gets its own ID.
  const rootA = `Can the ${label} release go out on Thursday?`;
  const draftA = `Only if the ${label} migration note is reviewed by Wednesday evening.`;
  const heldA = await startThread(page, world, rootA);
  try {
    await shot(page, `${label}-pending-root`);
    await expect(composer(page)).toBeVisible();
    await composer(page).click();
    await composer(page).fill(draftA);
    heldA.release();
    await expect.poll(() => threadIdOf(page), { timeout: 30_000 }).toMatch(/^\$/);
    await expect(composer(page)).toContainText(draftA);
    await pressSend(page);
    const rootIdA = threadIdOf(page);
    await expect(page.getByText(draftA, { exact: true }).last()).toBeVisible({ timeout: 30_000 });
    await expect(composer(page)).not.toContainText(draftA);
    await expect.poll(async () => (await serverReplies(world, rootIdA)).length).toBe(1);
    await expectReplyAfterRoot(world, rootIdA, draftA);
  } finally {
    heldA.release();
    await heldA.dispose();
  }

  // (b) A reply sent while the root waits goes out once the root is confirmed, after it.
  await page.goto(`/home/${encodeURIComponent(world.roomId)}/`);
  await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
    timeout: 60_000,
  });
  const rootB = `Who reviews the ${label} migration note?`;
  const replyB = `I can review the ${label} migration note this afternoon.`;
  const heldB = await startThread(page, world, rootB);
  try {
    await expect(composer(page)).toBeVisible();
    await composer(page).click();
    await composer(page).fill(replyB);
    await pressSend(page);
    await shot(page, `${label}-reply-waits`);
    await page.waitForTimeout(QUIET_MS);
    // Only the root has gone to the server.
    expect(sends.filter((body) => body === replyB)).toEqual([]);
    heldB.release();
    await expect.poll(() => threadIdOf(page), { timeout: 30_000 }).toMatch(/^\$/);
    const rootIdB = threadIdOf(page);
    await expect(page.getByText(replyB, { exact: true }).last()).toBeVisible({ timeout: 30_000 });
    await expect(composer(page)).not.toContainText(replyB);
    await expect.poll(async () => (await serverReplies(world, rootIdB)).length).toBe(1);
    await expectReplyAfterRoot(world, rootIdB, replyB);
    expect(sends.filter((body) => body === replyB)).toHaveLength(1);
    expect(sends.indexOf(replyB)).toBeGreaterThan(sends.indexOf(rootB));
    await shot(page, `${label}-reply-sent`);
  } finally {
    heldB.release();
    await heldB.dispose();
  }
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  for (const [viewport, options] of [
    ['phone', PHONE],
    ['desktop', DESKTOP],
  ] as const) {
    // WebKit sends the app's requests through its service worker, out of `page.route`'s reach.
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

test('a reply written before its thread root is confirmed is kept and sent after it (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test('a reply written before its thread root is confirmed is kept and sent after it (WebKit)', async ({
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
