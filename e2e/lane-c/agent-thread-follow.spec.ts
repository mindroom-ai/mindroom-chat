import type { Locator } from '@playwright/test';
import {
  expect,
  messageRow,
  openLobby,
  sendFromComposer,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
  waitForThreadEvent,
} from './agentStack';

// Regression (F12): in a thread taller than the screen, sending a message left the view where it was,
// with one's own message and the agent's streaming reply under the composer behind Jump to Latest.
// A reader at the bottom of a thread follows what they send and the reply that streams in.
test.describe.configure({ timeout: 300_000 });

/** The bottom edge of the row is on screen and nothing (the floating composer) covers it. */
const bottomShows = (row: Locator): Promise<boolean> =>
  row.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.height === 0 || rect.bottom > window.innerHeight) return false;
    const y = Math.max(rect.top + 1, rect.bottom - 6);
    const x = rect.left + Math.min(rect.width / 2, 120);
    const hit = document.elementFromPoint(x, y);
    return !!hit && element.contains(hit);
  });

test('sending in a long thread follows the new message and the streaming reply', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  const rootId = await startThread(stack, `${uniqueWord('follow')} #long`);
  await showThread(page, stack, rootId);
  const long = await waitForAgentReply(stack, rootId, (body) => body.includes('End of the long reply'));
  const longRow = messageRow(page, long.event_id);
  await expect(longRow).toContainText('End of the long reply', { timeout: 30_000 });

  // The thread is taller than the screen, and the reader is at its end.
  const jump = page.getByRole('button', { name: 'Jump to Latest' });
  await expect.poll(() => bottomShows(longRow), { timeout: 30_000 }).toBe(true);
  await expect(jump).toBeHidden();
  expect((await longRow.boundingBox())?.height ?? 0).toBeGreaterThan(page.viewportSize()!.height);

  await sendFromComposer(page, 'follow check #slow');
  const own = await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.tester.userId && event.content.body === 'follow check #slow',
    { description: 'the message just sent' }
  );
  const ownRow = messageRow(page, own.event_id);
  await expect.poll(() => bottomShows(ownRow), { timeout: 15_000 }).toBe(true);
  await expect(jump).toBeHidden();

  // The reply streams in under it, and the view keeps its growing end in sight.
  const reply = await waitForThreadEvent(
    stack,
    rootId,
    (event) =>
      event.sender === stack.agents.helper &&
      event.type === 'm.room.message' &&
      event.origin_server_ts > own.origin_server_ts,
    { description: "the helper's new reply" }
  );
  const replyRow = messageRow(page, reply.event_id);
  await expect(replyRow).toContainText('word10', { timeout: 60_000 });
  await expect.poll(() => bottomShows(replyRow), { timeout: 5_000 }).toBe(true);
  await waitForAgentReply(stack, rootId, (body) => body.includes('word30'));
  await expect(replyRow).toContainText('word30', { timeout: 30_000 });
  await expect.poll(() => bottomShows(replyRow), { timeout: 10_000 }).toBe(true);
  await expect(jump).toBeHidden();
});
