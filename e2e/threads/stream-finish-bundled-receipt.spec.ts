import { expect, test, type Browser, type Page, type Request, type Response } from '@playwright/test';
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

// Replies that finished streaming while the reader was away, read half-way on another device. A
// fresh client learns of a finished reply from the server with its newest edit bundled, and a
// bundled event carries no room ID: a receipt on it must still go to the room (the SDK builds the
// request path from the event). Against the slot's homeserver, desktop size, in Chromium and (with
// PLAYWRIGHT_WEBKIT_EXECUTABLE) WebKit: opening one thread reads it up to its finishing edit, and
// Mark as Read for the room reads its newest event, each on the room's path and accepted. The
// room's Mark as Read on a bundled edit, which needs that edit to be the room's newest event, has
// a unit test (readReceipts.streamFinish.test.ts).
const PASSWORD = 'stream-finish-bundled-receipt-spec-password';
const RUN = Date.now().toString(36);
const ROOM_NAME = 'Ops Review';
/** More than the first sync's timeline window. */
const LATER_MESSAGES = 40;
const FINISHED = 'The migration note is at the top and both missing entries are in the release notes.';

type Account = MatrixSession & { username: string };

const registerAndLogin = async (name: string): Promise<Account> => {
  const username = `sfb_${name}_${RUN}`;
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

type Streamed = { rootId: string; finishId: string };

/** A question, a reply streamed into its thread, read half-way elsewhere, then finished. */
const streamFinishedWhileAway = async (
  reader: Account,
  agent: MatrixSession,
  roomId: string,
  question: string
): Promise<Streamed> => {
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: question,
  });
  const replyId = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Checking the release notes.',
    'io.mindroom.stream_status': 'streaming',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  // Read half-way on another device.
  await matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(replyId)}`,
    { method: 'POST', accessToken: reader.accessToken, body: JSON.stringify({ thread_id: rootId }) }
  );
  const edit = (body: string, status: string) =>
    sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: `* ${body}`,
      'm.new_content': { msgtype: 'm.text', body, 'io.mindroom.stream_status': status },
      'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
    });
  await edit('Checking the release notes. Two entries are missing.', 'streaming');
  const finishId = await edit(`${FINISHED} (${question})`, 'completed');
  return { rootId, finishId };
};

type SentReceipt = { url: string; eventId: string; threadId?: string; status?: number };

const recordReceipts = (page: Page): SentReceipt[] => {
  const sent: SentReceipt[] = [];
  const byRequest = new Map<Request, SentReceipt>();
  page.on('request', (request: Request) => {
    const path = /\/receipt\/[^/]+\/([^/?]+)/.exec(request.url());
    if (request.method() !== 'POST' || !path) return;
    const { thread_id: threadId } = (request.postDataJSON() ?? {}) as { thread_id?: string };
    const receipt = { url: request.url(), eventId: decodeURIComponent(path[1] ?? ''), threadId };
    sent.push(receipt);
    byRequest.set(request, receipt);
  });
  page.on('response', (response: Response) => {
    const receipt = byRequest.get(response.request());
    if (receipt) receipt.status = response.status();
  });
  return sent;
};

/** Each receipt as `<room part of its path> <event> <thread> <status>`. */
const describeReceipts = (receipts: SentReceipt[]) =>
  receipts.map(({ url, eventId, threadId, status }) => {
    const room = decodeURIComponent(/\/rooms\/([^/]+)\/receipt\//.exec(url)?.[1] ?? '?');
    return `${room} ${eventId} ${threadId ?? 'unthreaded'} ${status ?? 'pending'}`;
  });

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const reader = await registerAndLogin(engine);
  const agent = await registerAgentAccount(HOMESERVER, `ops_${engine}`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const opened = await streamFinishedWhileAway(reader, agent, roomId, 'Is the changelog ready?');
  await streamFinishedWhileAway(reader, agent, roomId, 'Did the docs build pass?');
  // Later talk in the room pushes the edits out of the first sync's window: the fresh client
  // learns of each finished reply from the server's thread list, with its newest edit bundled.
  let newestId = '';
  for (let index = 1; index <= LATER_MESSAGES; index += 1)
    newestId = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.notice',
      body: `Deploy check ${index}: staging is healthy and the smoke tests passed.`,
    });

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL });
  try {
    const page = await context.newPage();
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
    await page.bringToFront();

    // Opening the first thread reads it up to its finishing edit, on the room's path.
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(opened.rootId)}`);
    await expect(page.getByText(`${FINISHED} (Is the changelog ready?)`).last()).toBeVisible({
      timeout: 60_000,
    });
    await expect
      .poll(() => describeReceipts(receipts.filter((r) => r.eventId === opened.finishId)), {
        timeout: 20_000,
      })
      .toEqual([`${roomId} ${opened.finishId} ${opened.rootId} 200`]);

    // Mark as Read for the room: one unthreaded receipt on the room's newest event, on the
    // room's path, accepted.
    await page.goto(`/home/${encodeURIComponent(roomId)}/`);
    await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
      timeout: 60_000,
    });
    const before = receipts.length;
    await page.getByRole('button', { name: 'More Options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Mark as Read', exact: true }).click();
    await expect
      .poll(() => describeReceipts(receipts.slice(before).filter((r) => !r.threadId)), {
        timeout: 20_000,
      })
      .toEqual([`${roomId} ${newestId} unthreaded 200`]);
    // No receipt of the session went anywhere but the room.
    expect(describeReceipts(receipts).filter((line) => !line.startsWith(`${roomId} `))).toEqual([]);
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('receipts on bundled finishing edits go to the room (Chromium)', async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  await run(browser, baseURL, 'chromium');
});

test('receipts on bundled finishing edits go to the room (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
