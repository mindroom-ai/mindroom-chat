import type { Locator, Route } from '@playwright/test';
import {
  expect,
  messageRow,
  openLobby,
  showThread,
  startThread,
  streamStatus,
  test,
  uniqueWord,
  waitForThreadEvent,
} from '../helpers/agentStack';

// The homeserver connection drops while an agent reply streams (L3-F016): live frames and edits
// stop together. The reply keeps the text the reader saw, past the 12 s a live entry lasts without
// frames, instead of shrinking back to its last edit, and goes on once the connection returns.
// Needs a live MindRoom backend with the stub model (e2e/helpers/agentStack.ts).
test.describe.configure({ timeout: 300_000 });

/** The highest `wordN` of the stub's numbered words the row shows. */
const highestWord = async (row: Locator): Promise<number> => {
  const text = await row.innerText();
  return Math.max(0, ...Array.from(text.matchAll(/word(\d+)/g), (match) => Number(match[1])));
};

test('a streaming reply keeps the text it showed when the connection drops', async ({
  page,
  context,
  stack,
}) => {
  await openLobby(page, stack);
  // 400 words, one every quarter second.
  const rootId = await startThread(stack, `${uniqueWord('drop')} #stopme`);
  await showThread(page, stack, rootId);
  const streaming = await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.agents.helper && streamStatus(event) === 'streaming',
    { description: 'a streaming reply' }
  );
  const reply = messageRow(page, streaming.event_id);
  await expect(reply).toContainText('word30', { timeout: 60_000 });

  const held: Route[] = [];
  const hold = (route: Route) => {
    held.push(route);
  };
  const toHomeserver = (url: URL) => url.origin === new URL(stack.homeserver).origin;
  await context.route(toHomeserver, hold);
  // The long poll in flight answers with the next frame; the one after it is held.
  await expect
    .poll(() => held.some((route) => route.request().url().includes('/sync')), { timeout: 30_000 })
    .toBe(true);
  const shownAtDrop = await highestWord(reply);

  await page.waitForTimeout(16_000);
  expect(await highestWord(reply), 'after 16 s without a connection').toBeGreaterThanOrEqual(
    shownAtDrop
  );

  await context.unroute(toHomeserver, hold);
  await Promise.all(held.map((route) => route.continue().catch(() => undefined)));
  await expect.poll(() => highestWord(reply), { timeout: 60_000 }).toBeGreaterThan(shownAtDrop);
  await reply.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(reply).toContainText('[Response cancelled by user]', { timeout: 30_000 });
});
