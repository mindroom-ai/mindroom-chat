import {
  expect,
  test,
  type Browser,
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
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The read state of the room the reader has open, against the server's counts. Coming back to the
// window reads what the reader then sees, and only that: the newest messages when they are on
// screen, nothing when the view moves to the New Messages line and leaves them below it. The line
// moves above the first message that arrived while the reader was away. And the open room's own
// sidebar badge equals the server's count for it, as every other row's does, also when the room
// holds a thread the reader once wrote in, and a reload shows it in every frame. No step sends a
// message as the reader after the room has unread messages: the server currently resets the
// sender's counts for the whole room on any send. The thread counts need a homeserver that lists
// every thread count in each /sync that carries the room (mindroom-tuwunel v1.9.4-mindroom.21 and
// later). Each case runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, in WebKit. Runs against the disposable homeserver of `just hs-up` or of a slot of
// scripts/e2e-slot.sh, and registers its own accounts. Set OPEN_ROOM_READ_SHOTS=<directory> to save
// screenshots of the steps that check the line and the badges.
const SHOTS = process.env.OPEN_ROOM_READ_SHOTS;
const PASSWORD = 'open-room-read-state-spec-password';
const RUN = Date.now().toString(36);
const VIEWPORT = { width: 1440, height: 900 };
const HISTORY = 30;

test.use({
  viewport: VIEWPORT,
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});
test.describe.configure({ timeout: 300_000 });

type Account = MatrixSession & { username: string };

const registerAndLogin = async (name: string): Promise<Account> => {
  const username = `orrs_${name}_${RUN}`;
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

/** A message of a few lines, as people write them. */
const message = (title: string) => ({
  msgtype: 'm.text',
  body: [
    `${title}: the morning tide came in at the usual height.`,
    'Crane two loaded the containers for berth four.',
  ].join('\n'),
});

const answerIn = (rootId: string, body: string) => ({
  msgtype: 'm.text',
  body,
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

/** A message in the timeline (a notification may show its text too). */
const inTimeline = (page: Page, text: string) =>
  page.getByTestId('room-virtual-inner').getByText(text, { exact: false }).first();

/** Moves within the app without reloading it, as its own links do. */
const openPath = (page: Page, path: string) =>
  page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);

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

/** The timeline's scroll area: its size, where it is, and how far it is above its bottom. */
const scrollArea = (page: Page) =>
  page.evaluate(() => {
    let element = document.querySelector<HTMLElement>(
      '[data-testid="room-virtual-inner"]'
    )?.parentElement;
    while (element && !/auto|scroll/.test(getComputedStyle(element).overflowY)) {
      element = element.parentElement;
    }
    if (!element) throw new Error('Timeline scroller missing');
    const { top, bottom, left, width, height } = element.getBoundingClientRect();
    const gap = Math.round(element.scrollHeight - element.clientHeight - element.scrollTop);
    return { top, bottom, x: left + width / 2, y: top + height / 2, gap };
  });

/** The reader turns the wheel down until the timeline is at its bottom. */
const backToBottom = async (page: Page) => {
  await expect
    .poll(
      async () => {
        const area = await scrollArea(page);
        if (area.gap > 2) {
          await page.mouse.move(area.x, area.y);
          await page.mouse.wheel(0, 1_200);
          await page.waitForTimeout(120);
        }
        return area.gap;
      },
      { timeout: 30_000 }
    )
    .toBeLessThanOrEqual(2);
};

/** The text of the row each "New Messages" line stands above. */
const unreadLineRows = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="separator"]'))
      .filter((separator) => separator.textContent?.includes('New Messages'))
      .map((separator) => (separator.parentElement?.textContent ?? '').replace('New Messages', ''))
  );

/** Whether the "New Messages" line is inside the scroll area's visible part. */
const unreadLineInView = async (page: Page) => {
  const area = await scrollArea(page);
  return page.evaluate(({ top, bottom }) => {
    const line = Array.from(document.querySelectorAll<HTMLElement>('[role="separator"]')).find(
      (separator) => separator.textContent?.includes('New Messages')
    );
    if (!line) return false;
    const rect = line.getBoundingClientRect();
    return rect.bottom > top && rect.top < bottom;
  }, area);
};

type Receipt = { type: string; event: string; thread?: unknown };

/** The read receipts the page sends, as labels. */
const recordReceipts = (page: Page, label: (eventId: string) => string): Receipt[] => {
  const receipts: Receipt[] = [];
  page.on('request', (request: Request) => {
    const { pathname } = new URL(request.url());
    const receipt = /\/receipt\/([^/]+)\/([^/?]+)$/.exec(pathname);
    if (!receipt || request.method() !== 'POST') return;
    const body = request.postDataJSON() as { thread_id?: unknown } | null;
    receipts.push({
      type: decodeURIComponent(receipt[1] ?? ''),
      event: label(decodeURIComponent(receipt[2] ?? '')),
      thread: body?.thread_id,
    });
  });
  return receipts;
};

/** Resolves after `count` more of the page's /sync requests have come back. */
const syncRoundTrips = async (page: Page, count = 2) => {
  for (let index = 0; index < count; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.waitForResponse(
      (response: Response) => new URL(response.url()).pathname.endsWith('/sync'),
      { timeout: 60_000 }
    );
  }
};

type RoomSync = {
  unread_notifications?: { notification_count?: number };
  unread_thread_notifications?: Record<string, { notification_count?: number }>;
};

/** The server's unread count for the reader in a room: its main timeline plus every thread. */
const serverCount = async (reader: Account, roomId: string): Promise<number> => {
  const filter = JSON.stringify({
    room: { rooms: [roomId], timeline: { limit: 1, unread_thread_notifications: true } },
  });
  const sync = await matrixFetch<{ rooms?: { join?: Record<string, RoomSync> } }>(
    HOMESERVER,
    `/sync?timeout=0&filter=${encodeURIComponent(filter)}`,
    { accessToken: reader.accessToken }
  );
  const room = sync.rooms?.join?.[roomId];
  const threads = Object.values(room?.unread_thread_notifications ?? {});
  return threads.reduce(
    (total, thread) => total + (thread.notification_count ?? 0),
    room?.unread_notifications?.notification_count ?? 0
  );
};

/** The count the room's sidebar row shows: its badge's number, 0 without one. */
const sidebarCount = async (page: Page, roomName: string): Promise<number> => {
  const text = (await page.getByRole('link', { name: roomName }).first().textContent()) ?? '';
  const digits = text.replace(roomName, '').replace(/\D/g, '');
  return digits ? Number(digits) : 0;
};

/**
 * The room's badge and the server's count once the page has had two /sync round trips to take in
 * what the server knows, so a failure shows both.
 */
const badgeAndServer = async (page: Page, reader: Account, roomId: string, roomName: string) => {
  await syncRoundTrips(page);
  const [badge, server] = await Promise.all([
    sidebarCount(page, roomName),
    serverCount(reader, roomId),
  ]);
  return { badge, server };
};

/** Saves a screenshot when OPEN_ROOM_READ_SHOTS names a directory. */
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** Keeps the pointer off the sidebar, whose rows swap their badge for buttons under it. */
const parkPointer = (page: Page) => page.mouse.move(VIEWPORT.width - 40, VIEWPORT.height / 2);

/**
 * Coming back to the window reads what the reader sees: the five messages that arrived while
 * away when they fit on screen below the line, and nothing when the line's place leaves the
 * newest ones out of view, until the reader scrolls down to them.
 */
const readOnFocus = async (page: Page, browserName: string) => {
  const reader = await registerAndLogin(`${browserName}_focus_reader`);
  const writer = await registerAndLogin(`${browserName}_focus_writer`);
  const roomName = `Harbor Log ${browserName} ${RUN}`;
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: roomName,
    invite: [writer.userId],
  });
  await joinRoom(HOMESERVER, writer.accessToken, roomId);

  const labels = new Map<string, string>();
  const label = (eventId: string) => labels.get(eventId) ?? eventId;
  const send = async (title: string) => {
    const eventId = await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, message(title));
    labels.set(eventId, title);
    return eventId;
  };
  let lastRead = '';
  for (let index = 1; index <= HISTORY - 2; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    lastRead = await send(`Log entry ${index}`);
  }
  // The reader read the room, then two more messages came.
  await matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(lastRead)}`,
    {
      method: 'POST',
      accessToken: reader.accessToken,
      body: JSON.stringify({ thread_id: 'main' }),
    }
  );
  await send(`Log entry ${HISTORY - 1}`);
  await send(`Log entry ${HISTORY}`);

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await parkPointer(page);
  const receipts = recordReceipts(page, label);
  const newest = () => [...labels.keys()].at(-1) ?? '';

  // Opening the room reads its two new messages, which fit on screen below the line.
  await openPath(page, `/home/${encodeURIComponent(roomId)}/`);
  await expect(inTimeline(page, `Log entry ${HISTORY}:`)).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(() => receipts.map((receipt) => receipt.event), { timeout: 20_000 })
    .toContain(`Log entry ${HISTORY}`);
  expect(await unreadLineRows(page)).toEqual([
    expect.stringContaining(`Log entry ${HISTORY - 1}:`),
  ]);
  receipts.splice(0);

  // Five messages arrive while the reader is in another window: nothing is read.
  await blurWindow(page);
  for (let index = 1; index <= 5; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send(`Away message ${index}`);
  }
  await expect(inTimeline(page, 'Away message 5:')).toBeVisible({
    timeout: 30_000,
  });
  const whileAway = await badgeAndServer(page, reader, roomId, roomName);
  expect(receipts, 'receipts while the window is not focused').toEqual([]);
  expect(whileAway).toEqual({ badge: 5, server: 5 });

  // Back in the window: the five fit on screen below the line, so they are read.
  await refocusWindow(page);
  await expect
    .poll(() => receipts, { timeout: 15_000, message: 'a receipt for the newest message' })
    .toEqual([{ type: 'm.read', event: 'Away message 5', thread: 'main' }]);
  expect(await unreadLineRows(page)).toEqual([expect.stringContaining('Away message 1:')]);
  expect(await badgeAndServer(page, reader, roomId, roomName)).toEqual({ badge: 0, server: 0 });
  await shot(page, `${browserName}-refocus-five-read`);
  receipts.splice(0);

  // Twelve long messages arrive while away: more than a screen. Coming back shows the line, and
  // the newest ones below the view stay unread until the reader scrolls down to them.
  await blurWindow(page);
  for (let index = 1; index <= 12; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const eventId = await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
      msgtype: 'm.text',
      body: [
        `Long report ${index}: the north quay inspection found three loose bollards.`,
        'The harbor master asked for a repair crew before the weekend.',
        'Two pilots reported fog at the outer buoys after midnight.',
        'The ferry schedule moves by ten minutes until the repairs end.',
        'Nothing else to report for this watch.',
      ].join('\n'),
    });
    labels.set(eventId, `Long report ${index}`);
  }
  await expect(inTimeline(page, 'Long report 12:')).toBeVisible({
    timeout: 30_000,
  });
  await refocusWindow(page);
  await expect.poll(() => unreadLineInView(page), { timeout: 15_000 }).toBe(true);
  expect(await unreadLineRows(page)).toEqual([expect.stringContaining('Long report 1:')]);
  const afterLongAway = await badgeAndServer(page, reader, roomId, roomName);
  expect(receipts, 'receipts while the newest messages are below the view').toEqual([]);
  expect(afterLongAway).toEqual({ badge: 12, server: 12 });
  await shot(page, `${browserName}-refocus-at-line`);

  await backToBottom(page);
  await expect
    .poll(() => receipts, { timeout: 15_000 })
    .toEqual([{ type: 'm.read', event: label(newest()), thread: 'main' }]);
  expect(await badgeAndServer(page, reader, roomId, roomName)).toEqual({ badge: 0, server: 0 });
};

/**
 * A room with two unread threads, one of which holds an older reply of the reader's, and unread
 * messages: its sidebar badge equals the server's count before the room opens, while it is open,
 * and after the reader leaves it. The messages after the threads push them out of the first
 * /sync's rows, so the client loads the threads' replies only when the room opens.
 */
const openRoomBadge = async (page: Page, browserName: string) => {
  const reader = await registerAndLogin(`${browserName}_badge_reader`);
  const writer = await registerAndLogin(`${browserName}_badge_writer`);
  const roomName = `Supply Desk ${browserName} ${RUN}`;
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: roomName,
    invite: [writer.userId],
  });
  await joinRoom(HOMESERVER, writer.accessToken, roomId);
  const otherName = `Quiet Corner ${browserName} ${RUN}`;
  const otherId = await createRoom(HOMESERVER, reader.accessToken, { name: otherName });

  const say = (content: Record<string, unknown>, account: Account = writer) =>
    sendRoomMessage(HOMESERVER, account.accessToken, roomId, content);
  const asked = await say(message('Which crates go to berth four'));
  // The reader once answered in this thread; then the writer wrote twice more there.
  await say(answerIn(asked, 'The red crates, as last week.'), reader);
  await say(answerIn(asked, 'Two of them are still on the quay, can you check?'));
  await say(answerIn(asked, 'Also the forklift needs a new battery.'));
  const second = await say(message('Who signs the delivery notes today'));
  for (let index = 1; index <= 3; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await say(answerIn(second, `Delivery note ${index} is waiting at the gate.`));
  }
  for (let index = 1; index <= 24; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await say(message(`Gate log ${index}`));
  }
  await say(message('The crane inspection moved to Thursday'));

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await parkPointer(page);
  await openPath(page, `/home/${encodeURIComponent(otherId)}/`);
  await expect(page.getByRole('link', { name: roomName }).first()).toBeVisible({
    timeout: 60_000,
  });

  const before = await badgeAndServer(page, reader, roomId, roomName);
  expect(before.server, 'server count before the room opens').toBeGreaterThan(0);
  expect(before.badge, 'badge before the room opens').toBe(before.server);

  await openPath(page, `/home/${encodeURIComponent(roomId)}/`);
  await expect(inTimeline(page, 'The crane inspection moved to Thursday')).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(3_000);
  const open = await badgeAndServer(page, reader, roomId, roomName);
  // The two threads stay unread: the reader opened neither.
  expect(open.server, 'server count with the room open').toBeGreaterThanOrEqual(5);
  expect(open.badge, 'badge with the room open').toBe(open.server);
  await shot(page, `${browserName}-open-room-badge`);

  await openPath(page, `/home/${encodeURIComponent(otherId)}/`);
  const after = await badgeAndServer(page, reader, roomId, roomName);
  expect(after.badge, 'badge after leaving the room').toBe(after.server);
};

/**
 * A reload keeps a room's badge while the client starts: the room has two unread messages after
 * the reader's own receipt, and its row shows 2 in every frame it is on screen.
 */
const badgeThroughReload = async (page: Page, browserName: string) => {
  const reader = await registerAndLogin(`${browserName}_reload_reader`);
  const writer = await registerAndLogin(`${browserName}_reload_writer`);
  const roomName = `Tide Table ${browserName} ${RUN}`;
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: roomName,
    invite: [writer.userId],
  });
  await joinRoom(HOMESERVER, writer.accessToken, roomId);
  const reading = (index: number) =>
    sendRoomMessage(HOMESERVER, writer.accessToken, roomId, message(`Tide reading ${index}`));
  let lastRead = '';
  for (let index = 1; index <= 4; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    lastRead = await reading(index);
  }
  // The reader read the room, then two more messages came. (The server resets the counts on any
  // receipt, wherever it points, so the receipt names the newest message of its time.)
  await matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(lastRead)}`,
    {
      method: 'POST',
      accessToken: reader.accessToken,
      body: JSON.stringify({ thread_id: 'main' }),
    }
  );
  await reading(5);
  await reading(6);

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await parkPointer(page);
  await expect.poll(() => sidebarCount(page, roomName), { timeout: 60_000 }).toBe(2);
  await syncRoundTrips(page);

  // Every frame after the reload records what the room's row shows, from when it first shows.
  await page.addInitScript((name: string) => {
    const samples: string[] = [];
    (window as unknown as { badgeSamples: string[] }).badgeSamples = samples;
    const sample = () => {
      const row = Array.from(document.querySelectorAll('a')).find((link) =>
        link.textContent?.includes(name)
      );
      if (row) samples.push((row.textContent ?? '').replace(name, '').replace(/\D/g, ''));
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, roomName);
  await page.reload();
  await expect.poll(() => sidebarCount(page, roomName), { timeout: 60_000 }).toBe(2);
  const settled = await badgeAndServer(page, reader, roomId, roomName);
  const samples = await page.evaluate(
    () => (window as unknown as { badgeSamples: string[] }).badgeSamples
  );
  expect(samples.length, 'frames with the row').toBeGreaterThan(0);
  expect([...new Set(samples)], 'what the row showed after the reload').toEqual(['2']);
  expect(settled).toEqual({ badge: 2, server: 2 });
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** Runs a case in Playwright's WebKit, in a page of the spec's viewport. */
const inWebKit = async (run: (page: Page) => Promise<void>) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const browser: Browser = await launchWebKit();
  try {
    const page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
    await run(page);
  } finally {
    await browser.close();
  }
};

test('coming back to the window reads what the reader then sees (Chromium)', async ({ page }) => {
  await readOnFocus(page, 'chromium');
});

test('coming back to the window reads what the reader then sees (WebKit)', async () => {
  await inWebKit((page) => readOnFocus(page, 'webkit'));
});

test('the open room’s badge equals the server’s count (Chromium)', async ({ page }) => {
  await openRoomBadge(page, 'chromium');
});

test('the open room’s badge equals the server’s count (WebKit)', async () => {
  await inWebKit((page) => openRoomBadge(page, 'webkit'));
});

test('a reload keeps the room’s badge while the client starts (Chromium)', async ({ page }) => {
  await badgeThroughReload(page, 'chromium');
});

test('a reload keeps the room’s badge while the client starts (WebKit)', async () => {
  await inWebKit((page) => badgeThroughReload(page, 'webkit'));
});
