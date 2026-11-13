import { expect, test, type Page, type Request } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
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
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The reader's first thread receipt in a room, against the disposable homeserver of a slot
// (scripts/e2e-slot.sh). The reader asked four questions, each the root of a thread, and Alice
// answered every one in its thread. The reader has never sent a thread receipt in the room, so the
// server counts all of Alice's answers. Opening one thread must leave each other thread unread on
// the client for as long as the server counts it, also after a reload, and opening another one
// later must send that thread's receipt. Each run registers its own accounts.
const PASSWORD = 'first-thread-receipt-spec-password';
const RUN = Date.now().toString(36);
const OLDER_MESSAGES = 24;
const ANSWERS_PER_THREAD = 6;
const QUESTIONS = [
  'Which venues are still open in May?',
  'What did the caterers quote?',
  'Who books the speakers their travel?',
  'Can the badges be printed on site?',
];

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

const registerAndLogin = async (name: string): Promise<Account> => {
  const username = `ftr_${name}_${RUN}`;
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

type SentReceipt = { eventId: string; threadId?: string };

/** The event a read receipt request names, and its thread. */
const parseReceipt = (request: Request): SentReceipt | undefined => {
  const path = /\/receipt\/[^/]+\/([^/?]+)/.exec(request.url());
  if (request.method() !== 'POST' || !path) return undefined;
  const { thread_id: threadId } = (request.postDataJSON() ?? {}) as { thread_id?: string };
  return { eventId: decodeURIComponent(path[1] ?? ''), threadId };
};

/** The read receipts the page sends, in order. */
const recordReceipts = (page: Page): SentReceipt[] => {
  const sent: SentReceipt[] = [];
  page.on('request', (request: Request) => {
    const receipt = parseReceipt(request);
    if (receipt) sent.push(receipt);
  });
  return sent;
};

/** How many of each thread's replies the server still counts for the reader. */
const serverThreadCounts = async (reader: Account, roomId: string, rootIds: string[]) => {
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
    accessToken: reader.accessToken,
  });
  const counts = sync.rooms?.join?.[roomId]?.unread_thread_notifications ?? {};
  // A thread the server counts nothing for is left out.
  return rootIds.map((rootId) => counts[rootId]?.notification_count ?? 0);
};

/** Whether each thread's card in the room overview shows as unread. */
const cardsUnread = (page: Page, rootIds: string[]) =>
  Promise.all(
    rootIds.map(async (rootId) => {
      const card = page.locator(`[data-thread-root-id="${rootId}"]`);
      return (await card.getAttribute('data-thread-unread', { timeout: 15_000 })) === 'true';
    })
  );

/**
 * Each thread as the client shows it and as the server counts it, one line per thread, so a
 * failure names the thread that disagrees.
 */
const threadStates = async (page: Page, reader: Account, roomId: string, rootIds: string[]) => {
  const [unread, counts] = await Promise.all([
    cardsUnread(page, rootIds),
    serverThreadCounts(reader, roomId, rootIds),
  ]);
  return rootIds.map(
    (_rootId, index) =>
      `${QUESTIONS[index]} ${unread[index] ? 'unread' : 'read'}, server ${counts[index]}`
  );
};

const expected = (states: Array<'unread' | 'read'>) =>
  states.map(
    (state, index) =>
      `${QUESTIONS[index]} ${state}, server ${state === 'unread' ? ANSWERS_PER_THREAD : 0}`
  );

const focusPage = async (page: Page) => {
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
};

/** Waits for the room's overview, where every main-timeline message has a card, to show the questions. */
const waitForOverview = async (page: Page, name: string, rootIds: string[]) => {
  await expect(page.getByRole('heading', { name }).first()).toBeVisible({ timeout: 30_000 });
  for (const rootId of rootIds)
    await expect(page.locator(`[data-thread-root-id="${rootId}"]`)).toBeVisible({
      timeout: 30_000,
    });
};

/** The next receipt the page sends for a thread. */
const nextThreadReceipt = (page: Page, rootId: string) =>
  page.waitForRequest((request) => parseReceipt(request)?.threadId === rootId, {
    timeout: 30_000,
  });

/** Opens a thread from its card and waits for its last answer. */
const openThread = async (page: Page, rootId: string, index: number) => {
  await page.locator(`[data-thread-root-id="${rootId}"]`).click();
  await expect(
    page.getByText(`${QUESTIONS[index]} Answer ${ANSWERS_PER_THREAD}`, { exact: true })
  ).toBeVisible({ timeout: 30_000 });
};

/** Opens a thread, waits for its receipt, and goes back. */
const readThread = async (page: Page, rootId: string, index: number) => {
  const receipt = nextThreadReceipt(page, rootId);
  await openThread(page, rootId, index);
  await receipt;
  await page.goBack();
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('the first thread receipt in a room leaves every other thread unread until it is opened', async ({
  page,
}) => {
  const name = 'Event Desk';
  const reader = await registerAndLogin('reader');
  const alice = await registerAndLogin('alice');
  // An agent, as in the rooms MindRoom users work in.
  const agent = await registerAgentAccount(HOMESERVER, 'helper');
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name,
    invite: [alice.userId, agent.userId],
  });
  await joinRoom(HOMESERVER, alice.accessToken, roomId);
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  for (let index = 1; index <= OLDER_MESSAGES; index += 1) {
    await sendRoomMessage(HOMESERVER, (index % 2 === 0 ? reader : alice).accessToken, roomId, {
      msgtype: 'm.text',
      body: `Planning chat, message ${index}`,
    });
  }
  // The reader's questions, then Alice's answers: the reader wrote last in the main timeline and
  // has sent no thread receipt in this room.
  const roots: string[] = [];
  for (const question of QUESTIONS)
    roots.push(
      await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
        msgtype: 'm.text',
        body: question,
      })
    );
  let newestAnswer = '';
  for (const [index, rootId] of roots.entries()) {
    for (let answer = 1; answer <= ANSWERS_PER_THREAD; answer += 1) {
      newestAnswer = await sendRoomMessage(
        HOMESERVER,
        alice.accessToken,
        roomId,
        answerIn(rootId, `${QUESTIONS[index]} Answer ${answer}`)
      );
    }
  }
  expect(await serverThreadCounts(reader, roomId, roots)).toEqual(
    roots.map(() => ANSWERS_PER_THREAD)
  );

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
  const receipts = recordReceipts(page);
  await focusPage(page);
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await waitForOverview(page, name, roots);
  await expect
    .poll(() => threadStates(page, reader, roomId, roots))
    .toEqual(expected(['unread', 'unread', 'unread', 'unread']));

  // The newest thread is the first the reader opens in this room.
  await readThread(page, roots[3]!, 3);
  await expect
    .poll(() => threadStates(page, reader, roomId, roots))
    .toEqual(expected(['unread', 'unread', 'unread', 'read']));

  // After a reload, the client knows only the server's receipts. The newest thread's receipt,
  // sent after its last answer, is now the room's oldest thread receipt; that thread stays read.
  await page.reload();
  await waitForOverview(page, name, roots);
  await expect
    .poll(() => threadStates(page, reader, roomId, roots))
    .toEqual(expected(['unread', 'unread', 'unread', 'read']));

  // An older thread opened later gets its own receipt.
  await readThread(page, roots[1]!, 1);
  await expect
    .poll(() => threadStates(page, reader, roomId, roots))
    .toEqual(expected(['unread', 'read', 'unread', 'read']));

  // The reader reads the whole room on another device: an unthreaded receipt.
  await matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(newestAnswer)}`,
    { method: 'POST', accessToken: reader.accessToken, body: '{}' }
  );
  await expect
    .poll(() => threadStates(page, reader, roomId, roots))
    .toEqual(expected(['read', 'read', 'read', 'read']));
  // Opening a thread that receipt read sends the thread no receipt; Alice's next answer gets one.
  const firstReceipt = nextThreadReceipt(page, roots[0]!);
  await openThread(page, roots[0]!, 0);
  const nextAnswer = await sendRoomMessage(
    HOMESERVER,
    alice.accessToken,
    roomId,
    answerIn(roots[0]!, `${QUESTIONS[0]} One more answer`)
  );
  expect(parseReceipt(await firstReceipt)?.eventId).toBe(nextAnswer);
  await page.goBack();
  await expect
    .poll(() => threadStates(page, reader, roomId, roots))
    .toEqual(expected(['read', 'read', 'read', 'read']));

  // Receipts went only to the opened threads, and none was unthreaded, which would read them all.
  expect(receipts.filter((receipt) => !receipt.threadId)).toEqual([]);
  const threadReceipts = receipts.flatMap(({ threadId }) =>
    threadId && threadId !== 'main' ? [threadId] : []
  );
  expect([...new Set(threadReceipts)]).toEqual([roots[3], roots[1], roots[0]]);
});
