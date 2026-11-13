import { expect, test, type Page, type Request } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Opening a thread reads its root, against the disposable homeserver of a slot
// (scripts/e2e-slot.sh). The root belongs to the main timeline, and the server reads the whole main
// timeline on any main receipt, so the client sends one only when nothing else there is unread;
// until then the opened root counts as read on this device. Alice starts three threads and the
// reader opens the newest: the room stays unread, and its Unread filter shows the other two. Once
// the reader opened those too, one main receipt reads the room on the server as well. Each run
// registers its own accounts.
const PASSWORD = 'thread-root-read-spec-password';
const RUN = Date.now().toString(36);
const OLDER_MESSAGES = 24;
const REPLIES_PER_THREAD = 6;

test.use({
  viewport: { width: 1600, height: 1000 },
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});
test.describe.configure({ timeout: 240_000 });

type Account = MatrixSession & { username: string };

const registerAndLogin = (name: string): Promise<Account> =>
  registerDisposableUser(`trr_${name}_${RUN}`, PASSWORD);

const inThread = (rootId: string, body: string) => ({
  msgtype: 'm.text',
  body,
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

type Receipt = { type: string; eventId: string; threadId?: string };

/** Every read receipt the page sends, in order. */
const watchReceipts = (page: Page): Receipt[] => {
  const receipts: Receipt[] = [];
  page.on('request', (request: Request) => {
    const match = /\/receipt\/([^/]+)\/([^/?]+)/.exec(request.url());
    if (request.method() !== 'POST' || !match) return;
    const body = (request.postDataJSON() ?? {}) as { thread_id?: string };
    receipts.push({
      type: decodeURIComponent(match[1] ?? ''),
      eventId: decodeURIComponent(match[2] ?? ''),
      threadId: body.thread_id,
    });
  });
  return receipts;
};

/** The reader's unread counts as the server reports them: main timeline and per thread. */
const serverCounts = async (reader: Account, roomId: string, rootIds: string[]) => {
  const filter = JSON.stringify({
    room: { timeline: { limit: 1, unread_thread_notifications: true } },
  });
  const sync = await matrixFetch<{
    rooms?: {
      join?: Record<
        string,
        {
          unread_notifications?: { notification_count?: number };
          unread_thread_notifications?: Record<string, { notification_count?: number }>;
        }
      >;
    };
  }>(HOMESERVER, `/sync?timeout=0&filter=${encodeURIComponent(filter)}`, {
    accessToken: reader.accessToken,
  });
  const room = sync.rooms?.join?.[roomId];
  // The server leaves out threads it counts nothing for.
  const threads = Object.fromEntries(
    rootIds.map((rootId) => [
      rootId,
      room?.unread_thread_notifications?.[rootId]?.notification_count ?? 0,
    ])
  );
  return { main: room?.unread_notifications?.notification_count ?? 0, threads };
};

/** The room's row in the room list; `data-highlight` says whether it shows as unread. */
const roomRow = (page: Page, name: string) =>
  page.locator('[data-highlight]').filter({ has: page.getByRole('link', { name }) });

const focusPage = async (page: Page) => {
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
};

const sendReceipt = (reader: Account, roomId: string, eventId: string, threadId: string) =>
  matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`,
    {
      method: 'POST',
      accessToken: reader.accessToken,
      body: JSON.stringify({ thread_id: threadId }),
    }
  );

/** A room Alice and a helper agent are in, with an older conversation the reader has read. */
const setUpRoom = async (name: string) => {
  // Accounts of their own per test: the tests of a run share its suffix.
  const prefix = name.split(' ')[0]?.toLowerCase() ?? 'room';
  const reader = await registerAndLogin(`${prefix}_reader`);
  const alice = await registerAndLogin(`${prefix}_alice`);
  // An agent, so the room shows the agent rooms' thread filters, Unread among them.
  const agent = await registerAgentAccount(HOMESERVER, 'helper');
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name,
    invite: [alice.userId, agent.userId],
  });
  await joinRoom(HOMESERVER, alice.accessToken, roomId);
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  let lastOlder = '';
  for (let index = 1; index <= OLDER_MESSAGES; index += 1) {
    const author = index % 3 === 0 ? reader : alice;
    lastOlder = await sendRoomMessage(HOMESERVER, author.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Earlier planning note ${index}`,
    });
  }
  // The reader read the older conversation, and has sent no thread receipt in this room.
  await sendReceipt(reader, roomId, lastOlder, 'main');
  return { reader, alice, roomId };
};

/** Alice starts a thread: a root and replies of her own. Answers the root's ID. */
const startThread = async (alice: Account, roomId: string, topic: string, replies: number) => {
  const rootId = await sendRoomMessage(HOMESERVER, alice.accessToken, roomId, {
    msgtype: 'm.text',
    body: topic,
  });
  for (let index = 1; index <= replies; index += 1) {
    await sendRoomMessage(
      HOMESERVER,
      alice.accessToken,
      roomId,
      inThread(rootId, `${topic}, note ${index}`)
    );
  }
  return rootId;
};

const signIn = async (page: Page, reader: Account, roomId: string) => {
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
};

const openOverview = async (page: Page, roomId: string, name: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await expect(page.getByRole('heading', { name }).first()).toBeVisible({ timeout: 30_000 });
};

/** Opens a thread from its card and waits until its replies show. */
const openThread = async (page: Page, rootId: string, lastReply: string) => {
  await page.locator(`[data-thread-root-id="${rootId}"]`).click();
  await expect(page.getByText(lastReply, { exact: true })).toBeVisible({ timeout: 30_000 });
};

/** Turns the overview's Unread filter on and answers the cards it shows. */
const showUnreadOnly = async (page: Page) => {
  const advancedFilters = page.locator('[data-thread-filter-mode-switch]');
  if ((await advancedFilters.getAttribute('aria-pressed')) !== 'true')
    await advancedFilters.click();
  await expect(advancedFilters).toHaveAttribute('aria-pressed', 'true');
  const unreadFilter = page.locator('[data-filter-key="unread"]');
  if ((await unreadFilter.getAttribute('data-filter-state')) !== 'include')
    await unreadFilter.click();
  await expect(unreadFilter).toHaveAttribute('data-filter-state', 'include');
  return page.locator('[data-thread-root-id]');
};

const expectCards = async (cards: ReturnType<Page['locator']>, rootIds: string[]) => {
  await expect(cards).toHaveCount(rootIds.length, { timeout: 15_000 });
  await expect
    .poll(() =>
      cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-thread-root-id')))
    )
    .toEqual(rootIds);
};

const mainReceipts = (receipts: Receipt[]) =>
  receipts.filter((receipt) => receipt.threadId === 'main');

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('opening a thread reads its root, and the room once every root is read', async ({ page }) => {
  const name = 'Planning Desk';
  const { reader, alice, roomId } = await setUpRoom(name);
  const topics = ['Venue options', 'Catering quotes', 'Travel budget'];
  const roots: string[] = [];
  for (const topic of topics)
    roots.push(await startThread(alice, roomId, topic, REPLIES_PER_THREAD));
  const [first, second, newest] = roots as [string, string, string];
  const lastReply = (index: number) => `${topics[index]}, note ${REPLIES_PER_THREAD}`;
  expect(await serverCounts(reader, roomId, roots)).toEqual({
    main: 3,
    threads: {
      [first]: REPLIES_PER_THREAD,
      [second]: REPLIES_PER_THREAD,
      [newest]: REPLIES_PER_THREAD,
    },
  });

  await signIn(page, reader, roomId);
  const receipts = watchReceipts(page);
  await focusPage(page);
  await openOverview(page, roomId, name);
  await expect(roomRow(page, name)).toHaveAttribute('data-highlight', 'true');

  // The newest thread: its replies are read, and its root on this device only, since a main
  // receipt would read the two older roots on the server too.
  const newestReceipt = page.waitForRequest(
    (request) =>
      request.url().includes('/receipt/') && request.postDataJSON()?.thread_id === newest,
    { timeout: 30_000 }
  );
  await openThread(page, newest, lastReply(2));
  await newestReceipt;
  await page.goBack();
  const cards = await showUnreadOnly(page);
  await expectCards(cards, [second, first]);
  await expect(roomRow(page, name)).toHaveAttribute('data-highlight', 'true');
  expect(mainReceipts(receipts)).toEqual([]);
  expect(await serverCounts(reader, roomId, roots)).toEqual({
    main: 3,
    threads: { [first]: REPLIES_PER_THREAD, [second]: REPLIES_PER_THREAD, [newest]: 0 },
  });

  // The device remembers the opened root across a reload.
  await page.reload();
  await expect(page.getByRole('heading', { name }).first()).toBeVisible({ timeout: 30_000 });
  await expectCards(await showUnreadOnly(page), [second, first]);

  // A thread is read once its opening scroll comes to rest: leave it only after its receipt.
  const secondReceipt = page.waitForRequest(
    (request) =>
      request.url().includes('/receipt/') && request.postDataJSON()?.thread_id === second,
    { timeout: 30_000 }
  );
  await openThread(page, second, lastReply(1));
  await secondReceipt;
  await page.goBack();
  await expectCards(await showUnreadOnly(page), [first]);
  expect(mainReceipts(receipts)).toEqual([]);

  // The last unread root: one main receipt reads the main timeline on the server.
  const mainReceipt = page.waitForRequest(
    (request) =>
      request.url().includes('/receipt/') && request.postDataJSON()?.thread_id === 'main',
    { timeout: 30_000 }
  );
  await openThread(page, first, lastReply(0));
  await mainReceipt;
  await page.goBack();
  await expectCards(await showUnreadOnly(page), []);
  await expect(roomRow(page, name)).toHaveAttribute('data-highlight', 'false');
  expect(mainReceipts(receipts)).toEqual([{ type: 'm.read', eventId: newest, threadId: 'main' }]);
  // Every receipt names its thread or the main timeline: an unthreaded one would read every
  // thread on this server.
  expect(receipts.filter((receipt) => !receipt.threadId)).toEqual([]);
  await expect
    .poll(() => serverCounts(reader, roomId, roots))
    .toEqual({ main: 0, threads: { [first]: 0, [second]: 0, [newest]: 0 } });
});

test('with private read receipts, opening the only unread thread reads the room privately', async ({
  page,
}) => {
  const name = 'Supplier Desk';
  const { reader, alice, roomId } = await setUpRoom(name);
  const rootId = await startThread(alice, roomId, 'Supplier shortlist', REPLIES_PER_THREAD);

  await signIn(page, reader, roomId);
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
    localStorage.setItem('settings', JSON.stringify({ ...settings, hideActivity: true }));
  });
  const receipts = watchReceipts(page);
  await focusPage(page);
  await openOverview(page, roomId, name);
  await expect(roomRow(page, name)).toHaveAttribute('data-highlight', 'true');

  const mainReceipt = page.waitForRequest(
    (request) =>
      request.url().includes('/receipt/') && request.postDataJSON()?.thread_id === 'main',
    { timeout: 30_000 }
  );
  await openThread(page, rootId, `Supplier shortlist, note ${REPLIES_PER_THREAD}`);
  await mainReceipt;
  await expect(roomRow(page, name)).toHaveAttribute('data-highlight', 'false');
  await expect
    .poll(() => receipts.map(({ type, threadId }) => `${type} ${threadId ?? 'unthreaded'}`))
    .toEqual(['m.read.private main', `m.read.private ${rootId}`]);
  await expect
    .poll(() => serverCounts(reader, roomId, [rootId]))
    .toEqual({ main: 0, threads: { [rootId]: 0 } });
});
