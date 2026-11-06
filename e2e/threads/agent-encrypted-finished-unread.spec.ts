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
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Regression (L5-F012): in an encrypted room, a reply the reader read half-way and then left
// finished while the reader was in another room. The server counted the finished reply as unread
// (the finished-stream rule), but the reader's sidebar showed the room read; a new session of the
// same account, which could not decrypt the room yet, showed one unread per streaming edit (23).
// The room's badge must show what the server counts, in the session that read half-way and in
// a new one.
test.describe.configure({ timeout: 420_000 });

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

/** Waits until the badge shows the server's count, which must be more than 0. */
const expectBadgeMatchesServer = async (
  page: Page,
  stack: AgentStack,
  roomId: string,
  log: string[],
  who: string
): Promise<void> => {
  await expect
    .poll(
      async () => {
        const server = await serverUnreadCounts(stack, roomId);
        const shown = await badgeCount(page, roomId);
        log.push(`${who}: badge ${shown}, server ${JSON.stringify(server)}`);
        return shown > 0 && shown === total(server);
      },
      {
        timeout: 60_000,
        intervals: [1000],
        message: `${who}'s badge shows the server's unread count`,
      }
    )
    .toBe(true);
};

const halfReadThenLeave = async (page: Page, stack: AgentStack, log: string[]) => {
  // Home lists the room; the room is in no space.
  const roomId = await createEncryptedAgentRoom(stack, 'Secure desk');
  await page.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
  await expect(composer(page)).toBeVisible({ timeout: 90_000 });
  // 30 words, one every quarter second.
  await mentionHelper(page, stack, '#slow read half of it');

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
      timeout: 90_000,
      intervals: [1000],
      message: 'the server counts the finished reply',
    })
    .toBeGreaterThan(0);
  log.push(`server after the finish: ${JSON.stringify(await serverUnreadCounts(stack, roomId))}`);
  return roomId;
};

test('a reply that finishes in an encrypted room while the reader is away shows the server count', async ({
  page,
  stack,
  browser,
  baseURL,
}) => {
  const log: string[] = [];
  try {
    const roomId = await halfReadThenLeave(page, stack, log);
    await expectBadgeMatchesServer(page, stack, roomId, log, 'reader');

    // A new session of the same account has no keys for the room yet.
    const fresh = await openNewSession(browser, stack, { baseURL });
    try {
      await expectBadgeMatchesServer(fresh, stack, roomId, log, 'new session');
    } finally {
      await fresh.context().close();
    }
  } finally {
    writeFileSync(test.info().outputPath('counts.log'), `${log.join('\n')}\n`);
  }
});

test('a reply that finishes in an encrypted room while the reader is away shows the server count (WebKit)', async ({
  stack,
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const log: string[] = [];
  const webkit = await launchWebKit();
  try {
    const page = await openNewSession(webkit, stack, { baseURL });
    const roomId = await halfReadThenLeave(page, stack, log);
    await expectBadgeMatchesServer(page, stack, roomId, log, 'reader');
  } finally {
    writeFileSync(test.info().outputPath('counts.log'), `${log.join('\n')}\n`);
    await webkit.close();
  }
});
