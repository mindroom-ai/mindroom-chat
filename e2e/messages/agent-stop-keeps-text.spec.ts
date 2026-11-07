import type { Page } from '@playwright/test';
import {
  bodyOf,
  expect,
  messageRow,
  openLobby,
  showThread,
  startThread,
  streamStatus,
  test,
  uniqueWord,
  waitForThreadEvent,
  type AgentStack,
  type MatrixEvent,
} from '../helpers/agentStack';
import { matrixFetch } from '../helpers/matrix';

// Stop while live frames show words the stored reply does not have yet (L3-F005), with a live
// MindRoom backend. While live frames run, the backend edits the stored reply only every
// `update_interval` (5 s); the frames carry the words in between. The reader presses Stop 8 words
// (2 s) after a stored edit landed.
test.describe.configure({ timeout: 300_000 });

const highestWord = (text: string): number =>
  Math.max(0, ...[...text.matchAll(/\bword(\d+)\b/g)].map((match) => Number(match[1])));

/** The highest word of the reply's newest stored edit: what a reload or another device shows. */
const storedWords = async (stack: AgentStack, eventId: string): Promise<number> => {
  const { chunk } = await matrixFetch<{ chunk: MatrixEvent[] }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(stack.rooms.lobby)}/relations/${encodeURIComponent(
      eventId
    )}/m.replace?dir=b&limit=1`,
    { accessToken: stack.tester.accessToken, apiVersion: 'v1' }
  );
  const newContent = chunk[0]?.content['m.new_content'] as { body?: unknown } | undefined;
  return highestWord(typeof newContent?.body === 'string' ? newContent.body : '');
};

/** Streams a 400-word reply and presses its Stop while the row shows words no stored edit has. */
const stopAheadOfStoredText = async (page: Page, stack: AgentStack) => {
  await openLobby(page, stack);
  // 400 words, one every quarter second.
  const rootId = await startThread(stack, `${uniqueWord('keep')} #stopme`);
  await showThread(page, stack, rootId);
  const streaming = await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.agents.helper && streamStatus(event) === 'streaming',
    { description: 'a streaming reply' }
  );
  const reply = messageRow(page, streaming.event_id);
  const stop = reply.getByRole('button', { name: 'Stop', exact: true });
  await expect(stop).toBeVisible({ timeout: 30_000 });
  const shownNow = async () => highestWord(await reply.innerText());

  // After 15 s the stored edits slow to one every 5 s.
  await expect.poll(shownNow, { timeout: 60_000 }).toBeGreaterThanOrEqual(64);
  const earlier = await storedWords(stack, streaming.event_id);
  let stored = earlier;
  await expect
    .poll(async () => (stored = await storedWords(stack, streaming.event_id)), {
      timeout: 30_000,
      intervals: [100],
      message: 'the next stored edit',
    })
    .toBeGreaterThan(earlier);
  await expect
    .poll(shownNow, { timeout: 15_000, intervals: [100] })
    .toBeGreaterThanOrEqual(stored + 8);
  const shown = await shownNow();
  await stop.click();

  const cancelled = await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.event_id === streaming.event_id && streamStatus(event) === 'cancelled',
    { description: 'the cancelled reply' }
  );
  expect(bodyOf(cancelled)).toContain('[Response cancelled by user]');
  const kept = highestWord(bodyOf(cancelled));
  test.info().annotations.push({
    type: 'words',
    description: `shown at Stop: ${shown}, stored edit before it: ${stored}, cancelled reply: ${kept}`,
  });
  return { reply, shown, kept };
};

test('a stopped reply shows the text its cancelled event holds', async ({ page, stack }) => {
  const { reply, kept } = await stopAheadOfStoredText(page, stack);
  await expect(reply).toContainText('[Response cancelled by user]', { timeout: 30_000 });
  await expect.poll(async () => highestWord(await reply.innerText())).toBe(kept);
  await expect(reply.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
});

test('a stopped reply keeps every word the reader saw when pressing Stop', async ({
  page,
  stack,
}) => {
  const { shown, kept } = await stopAheadOfStoredText(page, stack);
  expect(kept, 'the cancelled reply ends where the reader saw it end').toBeGreaterThanOrEqual(
    shown
  );
});
