import {
  expect,
  test,
  webkit,
  type Browser,
  type BrowserContextOptions,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';

// The Classic view shows each thread's replies among the room's rows. A reply the reader sees
// there is read, as it is in the open thread: at the bottom of the live end, with the window
// focused, its thread gets a receipt on it (or on the edit that finished it, when it was
// streamed), and the server stops counting it. Against the disposable homeserver of a slot
// (scripts/e2e-slot.sh), on a phone (390 by 844, touch) and a desktop (1280 by 800, the room list
// beside the room), in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit,
// in WebKit:
// - a reply that arrives while the reader is at the bottom;
// - replies that came while the reader was in another room, read on opening the room;
// - the window without focus: no receipt until the window gets its focus back;
// - scrolled up in the history: no receipt until the reader is back at the bottom;
// - a streamed reply that finishes in view: a receipt on the finishing edit.
// Set CLASSIC_RECEIPT_SHOTS=<directory> for screenshots of the room after each read.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'classic-thread-receipts-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.CLASSIC_RECEIPT_SHOTS;
const ROOM_NAME = 'Ops Desk';
const OTHER_ROOM_NAME = 'Design Desk';
const FILLER_ROOMS = 24;
const HISTORY = 40;
/** How long a receipt that should not come gets to show up anyway. */
const QUIET_MS = 3_000;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

type Account = MatrixSession & { username: string };

const registerAndLogin = async (name: string): Promise<Account> => {
  const username = `ctr_${name}_${RUN}`;
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

type World = {
  reader: Account;
  teammate: MatrixSession;
  roomId: string;
  otherRoomId: string;
};

const seed = async (engine: string): Promise<World> => {
  const reader = await registerAndLogin(engine);
  const teammate = await registerAgentAccount(HOMESERVER, `ops_${engine}`);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(teammate.userId)}/displayname`, {
    method: 'PUT',
    accessToken: teammate.accessToken,
    body: JSON.stringify({ displayname: 'Helper' }),
  });
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [teammate.userId],
  });
  await joinRoom(HOMESERVER, teammate.accessToken, roomId);
  const otherRoomId = await createRoom(HOMESERVER, reader.accessToken, { name: OTHER_ROOM_NAME });
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index}` });
  for (let index = 1; index <= HISTORY; index += 1) {
    const fromTeammate = index % 2 === 0;
    await sendRoomMessage(HOMESERVER, (fromTeammate ? teammate : reader).accessToken, roomId, {
      msgtype: 'm.text',
      body: fromTeammate
        ? `Ops item ${index}: the nightly backup finished, the disk alert cleared after the cleanup, and the certificate renews next week.`
        : `Ops item ${index}: anything we should look at before the weekend?`,
    });
  }
  await sendRoomMessage(HOMESERVER, reader.accessToken, otherRoomId, {
    msgtype: 'm.text',
    body: 'Mockups for the settings page are in the shared folder.',
  });
  return { reader, teammate, roomId, otherRoomId };
};

type SentReceipt = { eventId: string; threadId?: string; status?: number };

const receiptPath = (url: string) => /\/receipt\/[^/]+\/([^/?]+)/.exec(url);

/** The read receipts the page sends, in order, each with the server's answer once it came. */
const recordReceipts = (page: Page): SentReceipt[] => {
  const sent: SentReceipt[] = [];
  const byRequest = new Map<Request, SentReceipt>();
  page.on('request', (request: Request) => {
    const path = receiptPath(request.url());
    if (request.method() !== 'POST' || !path) return;
    const { thread_id: threadId } = (request.postDataJSON() ?? {}) as { thread_id?: string };
    const receipt = { eventId: decodeURIComponent(path[1] ?? ''), threadId };
    sent.push(receipt);
    byRequest.set(request, receipt);
  });
  page.on('response', (response: Response) => {
    const receipt = byRequest.get(response.request());
    if (receipt) receipt.status = response.status();
  });
  return sent;
};

/** Each receipt for `eventId`, as `<thread> <status>`. */
const receiptsFor = (receipts: SentReceipt[], eventId: string) =>
  receipts
    .filter((receipt) => receipt.eventId === eventId)
    .map((receipt) => `${receipt.threadId ?? 'unthreaded'} ${receipt.status ?? 'pending'}`);

const navigate = async (page: Page, route: string) => {
  await page.evaluate((target) => {
    window.history.pushState(null, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
};

const roomRoute = (roomId: string) => `/home/${encodeURIComponent(roomId)}/`;

const focusPage = async (page: Page) => {
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
};

/** Takes the window's focus away, as when the reader switches to another application. */
const blurWindow = (page: Page) =>
  page.evaluate(() => {
    document.hasFocus = () => false;
    window.dispatchEvent(new Event('blur'));
  });

/** Gives the window its focus back. */
const refocusWindow = (page: Page) =>
  page.evaluate(() => {
    delete (document as { hasFocus?: () => boolean }).hasFocus;
    window.dispatchEvent(new Event('focus'));
  });

const text = (page: Page, body: string) => page.getByText(body, { exact: true }).last();

const say = (world: World, body: string, extra: Record<string, unknown> = {}) =>
  sendRoomMessage(HOMESERVER, world.teammate.accessToken, world.roomId, {
    msgtype: 'm.text',
    body,
    ...extra,
  });

/** How many of the thread's replies the server still counts for the reader. */
const serverThreadCount = async (world: World, rootId: string) => {
  const filter = JSON.stringify({
    room: { timeline: { limit: 1, unread_thread_notifications: true } },
  });
  const sync = await matrixFetch<{
    rooms?: {
      join?: Record<
        string,
        { unread_thread_notifications?: Record<string, { notification_count?: number }> }
      >;
    };
  }>(HOMESERVER, `/sync?timeout=0&filter=${encodeURIComponent(filter)}`, {
    accessToken: world.reader.accessToken,
  });
  return (
    sync.rooms?.join?.[world.roomId]?.unread_thread_notifications?.[rootId]?.notification_count ?? 0
  );
};

/** The room's row in the room list; `data-highlight` says whether it shows as unread. */
const roomRow = (page: Page, name: string) =>
  page.locator('[data-highlight]').filter({ has: page.getByRole('link', { name }) });

/** How long the virtual list keeps reconciling a scroll to the newest row (TanStack Virtual). */
const PIN_RECONCILE_MS = 5_000;

/**
 * Scrolls the room's timeline up as a reader does (the mouse wheel; a finger's touch on a phone
 * in WebKit, which has no wheel), away from its newest rows but short of its top (which would load
 * older history), until the view offers Jump to Latest. It waits out the virtual list's last
 * scroll to the newest row first: a row that changes while that scroll still reconciles brings
 * the reader back to the bottom, whatever they did meanwhile (a defect of its own).
 */
const scrollUp = async (page: Page, olderBody: string) => {
  await page.waitForTimeout(PIN_RECONCILE_MS + 500);
  const box = await text(page, olderBody).boundingBox();
  if (!box) throw new Error(`No row shows "${olderBody}"`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  try {
    for (let step = 0; step < 6; step += 1) {
      await page.mouse.wheel(0, -150);
      await page.waitForTimeout(40);
    }
  } catch {
    await page.evaluate(async (body) => {
      const row = Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]')).find(
        (element) => element.textContent?.includes(body)
      );
      let area = row?.parentElement ?? null;
      while (area && !/(auto|scroll)/.test(getComputedStyle(area).overflowY))
        area = area.parentElement;
      if (!area) throw new Error('No scroll area');
      area.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
      for (let step = 0; step < 6; step += 1) {
        area.scrollBy(0, -150);
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      area.dispatchEvent(new TouchEvent('touchend', { bubbles: true }));
    }, olderBody);
  }
  await expect(page.getByRole('button', { name: 'Jump to Latest', exact: true })).toBeVisible({
    timeout: 10_000,
  });
};

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** Waits until thread `rootId` is read up to `targetId`, by the page and on the server. */
const expectRead = async (
  page: Page,
  world: World,
  receipts: SentReceipt[],
  rootId: string,
  targetId: string,
  desktop: boolean
) => {
  await expect
    .poll(() => receiptsFor(receipts, targetId), { timeout: 15_000 })
    .toContain(`${rootId} 200`);
  await expect.poll(() => serverThreadCount(world, rootId), { timeout: 15_000 }).toBe(0);
  if (desktop)
    await expect(roomRow(page, ROOM_NAME)).toHaveAttribute('data-highlight', 'false', {
      timeout: 15_000,
    });
};

const check = async (page: Page, world: World, label: string, desktop: boolean) => {
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'classic',
  });
  const receipts = recordReceipts(page);
  await focusPage(page);
  await page.goto(roomRoute(world.roomId));
  await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
    timeout: 60_000,
  });
  const root = `Ops ${label}: who takes the database upgrade on Saturday?`;
  const rootId = await say(world, root);
  await expect(text(page, root)).toBeVisible({ timeout: 30_000 });

  // (a) A reply arrives while the reader is at the bottom.
  const replyA = `Ops ${label}: I take the upgrade; the runbook is in the wiki and the rollback is tested.`;
  const replyAId = await say(world, replyA, inThread(rootId));
  await expect(text(page, replyA)).toBeVisible({ timeout: 30_000 });
  await expectRead(page, world, receipts, rootId, replyAId, desktop);
  await shot(page, `${label}-live-read`);

  // (b) Replies that came while the reader was in another room are read on opening the room.
  await navigate(page, roomRoute(world.otherRoomId));
  await expect(text(page, 'Mockups for the settings page are in the shared folder.')).toBeVisible({
    timeout: 30_000,
  });
  const replyB1 = `Ops ${label}: the maintenance window is from 06:00 to 08:00 UTC.`;
  const replyB1Id = await say(world, replyB1, inThread(rootId));
  const replyB2 = `Ops ${label}: I posted the notice in the status channel as well.`;
  const replyB2Id = await say(world, replyB2, inThread(rootId));
  await expect.poll(() => serverThreadCount(world, rootId), { timeout: 15_000 }).toBe(2);
  await page.waitForTimeout(QUIET_MS);
  expect([...receiptsFor(receipts, replyB1Id), ...receiptsFor(receipts, replyB2Id)]).toEqual([]);
  await navigate(page, roomRoute(world.roomId));
  await expect(text(page, replyB2)).toBeVisible({ timeout: 30_000 });
  await expectRead(page, world, receipts, rootId, replyB2Id, desktop);

  // (c) Without the window's focus, a reply is not read until the focus comes back.
  await blurWindow(page);
  const replyC = `Ops ${label}: the upgrade needs the read replica stopped first.`;
  const replyCId = await say(world, replyC, inThread(rootId));
  await expect(text(page, replyC)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(QUIET_MS);
  expect(receiptsFor(receipts, replyCId)).toEqual([]);
  expect(await serverThreadCount(world, rootId)).toBe(1);
  await refocusWindow(page);
  await expectRead(page, world, receipts, rootId, replyCId, desktop);

  // (d) Scrolled up in the history, a reply is not read until the reader is back at the bottom.
  await scrollUp(page, root);
  const replyD = `Ops ${label}: the replica is stopped, starting the upgrade now.`;
  const replyDId = await say(world, replyD, inThread(rootId));
  await expect.poll(() => serverThreadCount(world, rootId), { timeout: 15_000 }).toBe(1);
  await page.waitForTimeout(QUIET_MS);
  expect(receiptsFor(receipts, replyDId)).toEqual([]);
  await page.getByRole('button', { name: 'Jump to Latest', exact: true }).click();
  await expect(text(page, replyD)).toBeVisible({ timeout: 30_000 });
  await expectRead(page, world, receipts, rootId, replyDId, desktop);

  // (e) A streamed reply that finishes in view is read up to its finishing edit.
  const streaming = `Ops ${label}: checking the upgrade log for warnings.`;
  const finished = `Ops ${label}: the upgrade finished without warnings, the replica is back in sync, and the backups run again tonight.`;
  const streamId = await say(world, streaming, {
    ...inThread(rootId),
    'io.mindroom.stream_status': 'streaming',
  });
  await expect(text(page, streaming)).toBeVisible({ timeout: 30_000 });
  const finishId = await say(world, `* ${finished}`, {
    'm.new_content': {
      msgtype: 'm.text',
      body: finished,
      'io.mindroom.stream_status': 'completed',
    },
    'm.relates_to': { rel_type: 'm.replace', event_id: streamId },
  });
  await expect(text(page, finished)).toBeVisible({ timeout: 30_000 });
  await expectRead(page, world, receipts, rootId, finishId, desktop);
  await shot(page, `${label}-stream-read`);

  // Every thread receipt the page sent was accepted.
  expect(
    receipts.filter((receipt) => receipt.threadId === rootId && receipt.status !== 200)
  ).toEqual([]);
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  for (const [viewport, options] of [
    ['phone', PHONE],
    ['desktop', DESKTOP],
  ] as const) {
    const world = await seed(`${engine}_${viewport}`);
    const context = await browser.newContext({ ...options, baseURL });
    try {
      const page = await context.newPage();
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: world.reader.username,
        password: PASSWORD,
      });
      await check(page, world, `${engine} ${viewport}`, viewport === 'desktop');
    } finally {
      await context.close();
    }
  }
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('the Classic view reads the thread replies it shows (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(420_000);
  await run(browser, baseURL, 'chromium');
});

test('the Classic view reads the thread replies it shows (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(420_000);
  // The runner adds the project's launch options, whose Chromium flag WebKit refuses.
  const browser = await webkit.launch({ executablePath: WEBKIT, args: [] });
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
