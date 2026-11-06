import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  composer,
  createEncryptedAgentRoom,
  expect,
  mentionHelper,
  openNewSession,
  serverUnreadCounts,
  test,
  type AgentStack,
} from '../helpers/agentStack';
import { matrixFetch } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Regression (L5-F012): in an encrypted room, a reply the reader read half-way and then left
// finished while the reader was in another room. The server counted the finished reply as unread
// (the finished-stream rule), but the reader's sidebar showed the room read; a new session of the
// same account, which could not decrypt the room yet, showed one unread per streaming edit (23).
// The room's badge must show the finished reply as unread in the session that read half-way, no
// more than the server counts: the server counts an encrypted event whose push rules it cannot
// read (an agent's notice, such as the thread's title) as a message, the client does not. A new
// session must count fewer unread messages than the reply had streaming edits.
test.describe.configure({ timeout: 420_000 });

// Set E2EE_SHOTS=<directory> to save each session's sidebar once its badge shows.
const SHOTS = process.env.E2EE_SHOTS;

type Counts = Awaited<ReturnType<typeof serverUnreadCounts>>;

const total = (counts: Counts): number =>
  counts.room + Object.values(counts.threads).reduce((sum, count) => sum + count, 0);

/** The number on the room's sidebar badge; 0 for a dot or no badge. */
const badgeCount = async (page: Page, roomId: string): Promise<number> => {
  const text = await page
    .locator(`[data-room-id="${roomId}"]`)
    .first()
    .innerText()
    .catch(() => '');
  const match = /(\d+)\+?\s*$/.exec(text.trim());
  return match ? Number(match[1]) : 0;
};

/**
 * Waits until the badge shows unread messages and `fits` the badge and the server's count, on
 * three polls in a row: the counts move while the session decrypts.
 */
const expectBadgeShowsUnread = async (
  page: Page,
  stack: AgentStack,
  roomId: string,
  log: string[],
  who: string,
  fits: (shown: number, server: number) => boolean,
  expected: string
): Promise<void> => {
  let held = 0;
  await expect
    .poll(
      async () => {
        const server = await serverUnreadCounts(stack, roomId);
        const shown = await badgeCount(page, roomId);
        log.push(`${who}: badge ${shown}, server ${JSON.stringify(server)}`);
        held = shown > 0 && fits(shown, total(server)) ? held + 1 : 0;
        return held >= 3;
      },
      { timeout: 60_000, intervals: [1000], message: `${who}'s badge shows ${expected}` }
    )
    .toBe(true);
  if (SHOTS) {
    const engine = page.context().browser()?.browserType().name() ?? 'browser';
    await page.screenshot({
      path: `${SHOTS}/finished-unread-${who.replace(/ /g, '-')}-${engine}.png`,
    });
  }
};

/** The room's events as the server has them (relation and sender only) and the tester's receipts. */
const describeRoom = async (stack: AgentStack, roomId: string): Promise<string> => {
  type Raw = {
    event_id: string;
    type: string;
    sender: string;
    origin_server_ts: number;
    content: { 'm.relates_to'?: { rel_type?: string; event_id?: string } };
  };
  const { chunk } = await matrixFetch<{ chunk: Raw[] }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=100`,
    { accessToken: stack.tester.accessToken }
  );
  const filter = JSON.stringify({
    room: { rooms: [roomId], timeline: { limit: 1 }, ephemeral: { types: ['m.receipt'] } },
  });
  const sync = await matrixFetch<{
    rooms?: { join?: Record<string, { ephemeral?: { events?: unknown[] } }> };
  }>(stack.homeserver, `/sync?timeout=0&filter=${encodeURIComponent(filter)}`, {
    accessToken: stack.tester.accessToken,
  });
  const events = [...chunk]
    .reverse()
    .map((event) => {
      const relation = event.content['m.relates_to'];
      const who = event.sender === stack.tester.userId ? 'tester' : event.sender.split(':')[0];
      return `${event.origin_server_ts} ${event.event_id.slice(0, 8)} ${event.type} ${who} ${
        relation ? `${relation.rel_type}->${relation.event_id?.slice(0, 8)}` : ''
      }`;
    })
    .join('\n');
  return `${events}\nreceipts: ${JSON.stringify(sync.rooms?.join?.[roomId]?.ephemeral?.events)}`;
};

/**
 * Reads the router's welcome thread in a new room, its root with a main-timeline receipt and its
 * reply with a receipt in its thread, so the counts below are the reply's alone. A session that
 * cannot decrypt the welcome counts it otherwise: the server takes the reader's own message after
 * it as reading it, the SDK does not.
 */
const readRouterWelcome = async (stack: AgentStack, roomId: string): Promise<void> => {
  type Raw = { event_id: string; sender: string; content: { 'm.relates_to'?: unknown } };
  let welcome: Raw[] = [];
  await expect
    .poll(
      async () => {
        const { chunk } = await matrixFetch<{ chunk: Raw[] }>(
          stack.homeserver,
          `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=20`,
          { accessToken: stack.tester.accessToken }
        );
        welcome = chunk.filter(
          (event) => event.sender === stack.agents.router && event.content['m.relates_to'] !== undefined
        );
        const root = chunk.find(
          (event) => event.sender === stack.agents.router && !event.content['m.relates_to']
        );
        if (root) welcome = [root, ...welcome];
        return welcome.length;
      },
      { timeout: 30_000, intervals: [500, 1000], message: "the router's welcome thread" }
    )
    .toBeGreaterThanOrEqual(2);
  const [root, ...replies] = welcome;
  if (!root) throw new Error("The router's welcome has no root");
  const receipt = (eventId: string, threadId: string) =>
    matrixFetch(
      stack.homeserver,
      `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`,
      {
        method: 'POST',
        accessToken: stack.tester.accessToken,
        body: JSON.stringify({ thread_id: threadId }),
      }
    );
  await receipt(root.event_id, 'main');
  if (replies[0]) await receipt(replies[0].event_id, root.event_id);
};

const atMostServer = (shown: number, server: number) => shown <= server;
const AT_MOST_SERVER = "the room unread, at most the server's count";

/** How many streaming edits the helper's reply in the room had. */
const streamingEdits = async (stack: AgentStack, roomId: string): Promise<number> => {
  type Raw = { sender: string; content: { 'm.relates_to'?: { rel_type?: string } } };
  const { chunk } = await matrixFetch<{ chunk: Raw[] }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=200`,
    { accessToken: stack.tester.accessToken }
  );
  return chunk.filter(
    (event) =>
      event.sender === stack.agents.helper && event.content['m.relates_to']?.rel_type === 'm.replace'
  ).length;
};

/** The reader reads the start of a reply to `request`, then leaves before it finishes. */
const halfReadThenLeave = async (
  page: Page,
  stack: AgentStack,
  log: string[],
  request: string
) => {
  // Home lists the room; the room is in no space.
  const roomId = await createEncryptedAgentRoom(stack, 'Secure desk');
  await readRouterWelcome(stack, roomId);
  await page.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
  await expect(composer(page)).toBeVisible({ timeout: 90_000 });
  await mentionHelper(page, stack, request);

  // The client follows the reply's thread; the reader reads the start, then leaves for the lobby.
  await expect(page.getByText(/\bword3\b/).first()).toBeVisible({ timeout: 60_000 });
  await page.evaluate((url) => {
    window.history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/home/${encodeURIComponent(stack.rooms.lobby)}`);
  await expect(page.getByText(/\bword3\b/)).toHaveCount(0, { timeout: 30_000 });

  // The finished reply counts as unread on the server.
  await expect
    .poll(async () => total(await serverUnreadCounts(stack, roomId)), {
      timeout: 200_000,
      intervals: [1000],
      message: 'the server counts the finished reply',
    })
    .toBeGreaterThan(0);
  log.push(`server after the finish: ${JSON.stringify(await serverUnreadCounts(stack, roomId))}`);
  return roomId;
};

test('a reply that finishes in an encrypted room while the reader is away leaves the room unread', async ({
  page,
  stack,
  browser,
  baseURL,
}) => {
  const log: string[] = [];
  let roomId: string | undefined;
  try {
    // 400 words, one every quarter second: a reply with many streaming edits.
    roomId = await halfReadThenLeave(page, stack, log, '#stopme read half of it');
    await expectBadgeShowsUnread(page, stack, roomId, log, 'reader', atMostServer, AT_MOST_SERVER);
    const edits = await streamingEdits(stack, roomId);
    log.push(`streaming edits: ${edits}`);

    // A new session of the same account has no keys for the room yet.
    const fresh = await openNewSession(browser, stack, { baseURL });
    try {
      await expectBadgeShowsUnread(
        fresh,
        stack,
        roomId,
        log,
        'new session',
        (shown) => shown < edits,
        `the room unread, fewer than the reply's ${edits} edits`
      );
    } finally {
      await fresh.context().close();
    }
  } finally {
    if (roomId) log.push(await describeRoom(stack, roomId));
    writeFileSync(test.info().outputPath('counts.log'), `${log.join('\n')}\n`);
  }
});

test('a reply that finishes in an encrypted room while the reader is away leaves the room unread (WebKit)', async ({
  stack,
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const log: string[] = [];
  const webkit = await launchWebKit();
  try {
    const page = await openNewSession(webkit, stack, { baseURL });
    // 30 words, one every quarter second.
    const roomId = await halfReadThenLeave(page, stack, log, '#slow read half of it');
    await expectBadgeShowsUnread(page, stack, roomId, log, 'reader', atMostServer, AT_MOST_SERVER);
  } finally {
    writeFileSync(test.info().outputPath('counts.log'), `${log.join('\n')}\n`);
    await webkit.close();
  }
});
