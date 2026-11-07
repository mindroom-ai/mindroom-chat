import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  composer,
  createAgentRoom,
  createEncryptedAgentRoom,
  expect,
  mentionHelper,
  openNewSession,
  readRouterWelcome,
  sendFromComposer,
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
// session must count fewer unread messages than the reply had streaming edits. The tests skip on a
// homeserver without mindroom-tuwunel#133 (v1.9.4-mindroom.21); #135 (v1.9.4-mindroom.22) gives the
// server's own count of the finished reply.
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
      event.sender === stack.agents.helper &&
      event.content['m.relates_to']?.rel_type === 'm.replace'
  ).length;
};

/**
 * Whether the homeserver lists the room's thread counts on a sync that carries the room for
 * another reason, here the tester's typing (mindroom-tuwunel#133, v1.9.4-mindroom.21 and later).
 * An older one leaves the map out, which by MSC3773 says no thread has notifications, so the SDK
 * clears the thread counts it keeps itself in an encrypted room on each such sync.
 */
const listsThreadCountsOnEverySync = async (stack: AgentStack, roomId: string) => {
  type Joined = { timeline?: { events?: unknown[] }; unread_thread_notifications?: unknown };
  type Sync = { next_batch: string; rooms?: { join?: Record<string, Joined> } };
  const filter = encodeURIComponent(
    JSON.stringify({
      room: {
        rooms: [roomId],
        timeline: { limit: 5, unread_thread_notifications: true },
        ephemeral: { types: ['m.typing'] },
      },
    })
  );
  const sync = (since?: string) =>
    matrixFetch<Sync>(
      stack.homeserver,
      `/sync?filter=${filter}&timeout=${since ? 5000 : 0}${since ? `&since=${since}` : ''}`,
      { accessToken: stack.tester.accessToken }
    );
  const typing = (on: boolean) =>
    matrixFetch(
      stack.homeserver,
      `/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(stack.tester.userId)}`,
      {
        method: 'PUT',
        accessToken: stack.tester.accessToken,
        body: JSON.stringify(on ? { typing: true, timeout: 10_000 } : { typing: false }),
      }
    );
  let since = (await sync()).next_batch;
  await typing(true);
  try {
    // The first round that carries the room with no new events of its own.
    for (let round = 0; round < 5; round += 1) {
      const next = await sync(since);
      since = next.next_batch;
      const joined = next.rooms?.join?.[roomId];
      if (joined && !joined.timeline?.events?.length) {
        return joined.unread_thread_notifications !== undefined;
      }
    }
    return true;
  } finally {
    await typing(false);
  }
};

/** The reader reads the start of a reply to `request`, then leaves before it finishes. */
const halfReadThenLeave = async (page: Page, stack: AgentStack, log: string[], request: string) => {
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
  test.skip(
    !(await listsThreadCountsOnEverySync(stack, roomId)),
    'The homeserver leaves thread counts out of syncs that carry a room without new events ' +
      '(mindroom-tuwunel#133, in v1.9.4-mindroom.21 and later); the SDK then clears the counts ' +
      'of encrypted rooms. Run with a newer image (MRC_TUWUNEL_IMAGE).'
  );
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

/**
 * The reader asks the helper and leaves at once, before any of the reply arrives. The reply streams
 * and finishes while the reader is in the lobby: one unread message. The server counts only the
 * finished reply (its stream status is in the clear, and Tuwunel counts no event that still
 * streams); the client counted the reply's first event too, and showed 2, and 3 after a reload.
 */
test('a reply that comes while the reader is away counts once, also after a reload', async ({
  page,
  stack,
}) => {
  const log: string[] = [];
  let roomId: string | undefined;
  try {
    roomId = await createEncryptedAgentRoom(stack, 'Agenda desk');
    await readRouterWelcome(stack, roomId);
    await page.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
    await expect(composer(page)).toBeVisible({ timeout: 90_000 });
    // 30 words, one every quarter second.
    await mentionHelper(page, stack, '#slow what is on the agenda today?');
    await page.evaluate((url) => {
      window.history.pushState(null, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, `/home/${encodeURIComponent(stack.rooms.lobby)}`);
    await expect(composer(page)).toBeVisible({ timeout: 30_000 });

    // The reply finishes and the server counts it.
    await expect
      .poll(async () => total(await serverUnreadCounts(stack, roomId!)), {
        timeout: 200_000,
        intervals: [1000],
        message: 'the server counts the finished reply',
      })
      .toBeGreaterThan(0);
    // The thread's title notice and the summary come after the reply.
    await page.waitForTimeout(5_000);
    log.push(`server after the finish: ${JSON.stringify(await serverUnreadCounts(stack, roomId))}`);
    const once = (shown: number, server: number) => shown === 1 && shown <= server;
    await expectBadgeShowsUnread(page, stack, roomId, log, 'live', once, 'one unread reply');

    await page.reload();
    await expect(composer(page)).toBeVisible({ timeout: 90_000 });
    await expectBadgeShowsUnread(page, stack, roomId, log, 'reload', once, 'one unread reply');
  } finally {
    if (roomId) log.push(await describeRoom(stack, roomId));
    writeFileSync(test.info().outputPath('counts.log'), `${log.join('\n')}\n`);
  }
});

// Regression (P2-e2ee-F001): a reply the reader watched to its end left an encrypted room unread
// for good (badge 1, the server 0) whenever no title notice followed it: a stopped reply, and a
// follow-up reply in a thread that has its title already. The client's receipt names the reply's
// terminal edit, and the client did not take a receipt on an edit as reading it; after a reload
// the edit decrypted again and counted again. An unencrypted room, where the client takes the
// server's counts, never showed it.

/** Moves the loaded client to Home, where the sidebar (or the phone's list) shows the room. */
const goHome = async (page: Page, roomId: string): Promise<void> => {
  await page.evaluate(() => {
    window.history.pushState(null, '', '/home/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator(`[data-room-id="${roomId}"]`).first()).toBeVisible({
    timeout: 30_000,
  });
};

/** Waits until the room shows no badge and the server counts nothing, for five polls in a row. */
const expectRoomRead = async (
  page: Page,
  stack: AgentStack,
  roomId: string,
  log: string[],
  who: string
): Promise<void> => {
  let held = 0;
  await expect
    .poll(
      async () => {
        const server = await serverUnreadCounts(stack, roomId);
        const shown = await badgeCount(page, roomId);
        log.push(`${who}: badge ${shown}, server ${JSON.stringify(server)}`);
        held = shown === 0 && total(server) === 0 ? held + 1 : 0;
        return held >= 5;
      },
      { timeout: 45_000, intervals: [1000], message: `${who}: the room is read, as on the server` }
    )
    .toBe(true);
  if (SHOTS) {
    const engine = page.context().browser()?.browserType().name() ?? 'browser';
    await page.screenshot({
      path: `${SHOTS}/watched-read-${who.replace(/ /g, '-')}-${engine}.png`,
    });
  }
};

const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop', exact: true });

/** Waits for a reply to start streaming and then to finish: its Stop button comes and goes. */
const watchReplyToItsEnd = async (page: Page): Promise<void> => {
  await expect(stopButton(page)).toBeVisible({ timeout: 90_000 });
  await expect(stopButton(page)).toBeHidden({ timeout: 120_000 });
};

type Ending = 'stop' | 'follow-up';

/**
 * The reader asks the helper in a new room and watches the reply: stops it after a few words, or
 * reads it to its end and then a follow-up reply in the same thread. The thread's title notice
 * follows the first reply only. Then the reader goes Home.
 */
const watchThenGoHome = async (
  page: Page,
  stack: AgentStack,
  encrypted: boolean,
  ending: Ending
): Promise<string> => {
  const roomId = await createAgentRoom(stack, `Watched ${ending}`, encrypted);
  await readRouterWelcome(stack, roomId);
  await page.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
  await expect(composer(page)).toBeVisible({ timeout: 90_000 });
  if (ending === 'stop') {
    // 400 words, one every quarter second; the client follows the reply's thread.
    await mentionHelper(page, stack, '#stopme watch it and stop it');
    await expect(page.getByText(/\bword5\b/).first()).toBeVisible({ timeout: 90_000 });
    await stopButton(page).click();
    await expect(page.getByText('[Response cancelled by user]').first()).toBeVisible({
      timeout: 60_000,
    });
  } else {
    // 30 words, one every quarter second, and the thread's title after them.
    await mentionHelper(page, stack, '#slow first question');
    await watchReplyToItsEnd(page);
    await expect(page.getByText(/\bword30\b/).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(5_000);
    await sendFromComposer(page, '#slow follow up in thread');
    await watchReplyToItsEnd(page);
  }
  // The reader keeps watching a moment, as a person does.
  await page.waitForTimeout(6_000);
  await goHome(page, roomId);
  return roomId;
};

const watchedLeavesRoomRead = async (
  page: Page,
  stack: AgentStack,
  encrypted: boolean,
  ending: Ending
): Promise<void> => {
  const log: string[] = [];
  let roomId: string | undefined;
  try {
    roomId = await watchThenGoHome(page, stack, encrypted, ending);
    const kind = `${encrypted ? 'encrypted' : 'plain'} ${ending}`;
    await expectRoomRead(page, stack, roomId, log, `${kind} live`);
    await page.reload();
    await goHome(page, roomId);
    await expectRoomRead(page, stack, roomId, log, `${kind} reload`);
  } finally {
    if (roomId) log.push(await describeRoom(stack, roomId));
    writeFileSync(test.info().outputPath('counts.log'), `${log.join('\n')}\n`);
  }
};

for (const ending of ['stop', 'follow-up'] as const) {
  const reply = ending === 'stop' ? 'stopped' : 'follow-up';
  test(`a ${reply} reply the reader watched leaves an encrypted room read`, async ({
    page,
    stack,
  }) => {
    await watchedLeavesRoomRead(page, stack, true, ending);
  });

  test(`a ${reply} reply the reader watched leaves an unencrypted room read`, async ({
    page,
    stack,
  }) => {
    await watchedLeavesRoomRead(page, stack, false, ending);
  });
}

test('a follow-up reply the reader watched leaves an encrypted room read (WebKit phone)', async ({
  stack,
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const webkit = await launchWebKit();
  try {
    const page = await openNewSession(webkit, stack, {
      baseURL,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    await watchedLeavesRoomRead(page, stack, true, 'follow-up');
  } finally {
    await webkit.close();
  }
});
