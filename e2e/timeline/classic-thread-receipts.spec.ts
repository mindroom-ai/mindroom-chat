import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { roomMoreOptions } from '../helpers/roomMenu';
import { expectRoomCompact, setRoomCompact } from '../helpers/roomViewSwitch';
import { launchWebKit } from '../helpers/webkit';
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
import { openThreadsCategory } from '../helpers/threadsCategory';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

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

/**
 * Scrolls the room's timeline up as a reader does (the mouse wheel; a finger's touch on a phone
 * in WebKit, which has no wheel), away from its newest rows but short of its top (which would load
 * older history), until the view offers Jump to Latest.
 */
const scrollUp = async (page: Page, olderBody: string) => {
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
  // Observe the mounted window and scroll position while the explicit jump settles. A range
  // counted in room rows must expand to include the Classic view's newest thread reply.
  const frames = page.evaluate(
    () =>
      new Promise<unknown[]>((resolve) => {
        const samples: unknown[] = [];
        const start = performance.now();
        const sample = () => {
          const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]'));
          let area = rows.at(-1)?.parentElement ?? null;
          while (area && !/(auto|scroll)/.test(getComputedStyle(area).overflowY))
            area = area.parentElement;
          samples.push({
            ms: Math.round(performance.now() - start),
            ids: rows.map((row) => row.dataset.messageId),
            scrollTop: area?.scrollTop,
            scrollHeight: area?.scrollHeight,
            clientHeight: area?.clientHeight,
          });
          if (performance.now() - start < 1_500) requestAnimationFrame(sample);
          else resolve(samples);
        };
        sample();
      })
  );
  await page.getByRole('button', { name: 'Jump to Latest', exact: true }).click();
  await test.info().attach('jump-frames', {
    body: JSON.stringify({ replyDId, frames: await frames }, null, 2),
    contentType: 'application/json',
  });
  if (SHOTS) {
    await page.waitForTimeout(1_000);
    await shot(page, `${label}-jump-latest`);
  }
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

/**
 * The live test's way into Classic (L4-F015): the room shows Compact, the reader picks Jump to
 * Time, Beginning (which keeps Classic for the room), leaves for another room while a teammate
 * starts a thread and answers in it, and comes back to the room's live end. The thread is read:
 * its receipt, the server's count, and on a desktop the room's row, the thread's entry in the
 * sidebar's THREADS list and its card once the room shows Compact again.
 */
const checkJumpEntered = async (page: Page, world: World, label: string, desktop: boolean) => {
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  const receipts = recordReceipts(page);
  await focusPage(page);
  await page.goto(roomRoute(world.roomId));
  await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expectRoomCompact(page, true);

  await expect(roomMoreOptions(page)).toBeVisible({ timeout: 60_000 });
  await roomMoreOptions(page).click();
  await page.getByRole('menuitem', { name: 'Jump to Time' }).click();
  const dialog = page.getByRole('dialog', { name: 'Jump to Time' });
  await dialog.getByRole('button', { name: 'Beginning' }).click();
  await dialog.getByRole('button', { name: 'Open Timeline' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    text(page, 'Ops item 1: anything we should look at before the weekend?')
  ).toBeVisible({ timeout: 60_000 });
  await expectRoomCompact(page, false);

  await navigate(page, roomRoute(world.otherRoomId));
  await expect(text(page, 'Mockups for the settings page are in the shared folder.')).toBeVisible({
    timeout: 30_000,
  });
  const root = `Ops ${label}: who reviews the access list before the audit?`;
  const rootId = await say(world, root);
  const reply = `Ops ${label}: I review it on Thursday and send the changes to the team.`;
  const replyId = await say(world, reply, inThread(rootId));
  await expect.poll(() => serverThreadCount(world, rootId), { timeout: 15_000 }).toBe(1);

  await navigate(page, roomRoute(world.roomId));
  await expect(text(page, reply)).toBeVisible({ timeout: 30_000 });
  await expectRoomCompact(page, false);
  await expectRead(page, world, receipts, rootId, replyId, desktop);
  await shot(page, `${label}-jump-entered-read`);
  if (desktop) {
    // The THREADS category starts collapsed until the person opens it.
    await openThreadsCategory(page);
    const entry = page.locator('[data-highlight]').filter({
      has: page.getByRole('button', { name: `Open thread: ${root}` }),
    });
    await expect(entry).toHaveAttribute('data-highlight', 'false', { timeout: 15_000 });
  }
  await setRoomCompact(page, true);
  const card = page.locator(`[data-thread-root-id="${rootId}"]`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).not.toHaveAttribute('data-thread-unread', 'true');
  await shot(page, `${label}-jump-entered-compact`);
};

const run = async (
  browser: Browser,
  baseURL: string | undefined,
  engine: string,
  viewport: 'phone' | 'desktop',
  theme: 'light' | 'dark',
  checkRoom: typeof check = check
) => {
  const world = await seed(`${engine}_${viewport}_${theme}${checkRoom === check ? '' : '_jump'}`);
  const context = await browser.newContext({
    ...(viewport === 'phone' ? PHONE : DESKTOP),
    baseURL,
  });
  const timeline: unknown[] = [];
  try {
    const page = await context.newPage();
    await page.addInitScript((mode) => {
      localStorage.setItem('mindroom.debug.timeline', '1');
      const settings = JSON.parse(localStorage.getItem('settings') ?? '{}');
      localStorage.setItem(
        'settings',
        JSON.stringify({
          ...settings,
          useSystemTheme: false,
          themeId: `${mode}-theme`,
        })
      );
    }, theme);
    page.on('console', (message) => {
      if (message.text().startsWith('[timeline-debug]')) {
        void Promise.all(message.args().map((arg) => arg.jsonValue())).then((args) =>
          timeline.push(args)
        );
      }
    });
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    await checkRoom(page, world, `${engine}-${viewport}-${theme}`, viewport === 'desktop');
  } finally {
    await test.info().attach('timeline-log', {
      body: JSON.stringify(timeline, null, 2),
      contentType: 'application/json',
    });
    await context.close();
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

for (const engine of ['chromium', 'webkit'] as const) {
  for (const viewport of ['phone', 'desktop'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`Classic thread reads, ${engine}, ${viewport}, ${theme}`, async ({
        browser,
        baseURL,
      }) => {
        test.skip(engine === 'webkit' && !WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
        test.setTimeout(180_000);
        const host = engine === 'webkit' ? await launchWebKit() : undefined;
        try {
          await run(host ?? browser, baseURL, engine, viewport, theme);
        } finally {
          await host?.close();
        }
      });
    }
    // Light on a desktop, dark on a phone: the receipts do not depend on the theme.
    const theme = viewport === 'desktop' ? 'light' : 'dark';
    test(`Classic thread read after Jump to Time, ${engine}, ${viewport}, ${theme}`, async ({
      browser,
      baseURL,
    }) => {
      test.skip(engine === 'webkit' && !WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
      test.setTimeout(180_000);
      const host = engine === 'webkit' ? await launchWebKit() : undefined;
      try {
        await run(host ?? browser, baseURL, engine, viewport, theme, checkJumpEntered);
      } finally {
        await host?.close();
      }
    });
  }
}
