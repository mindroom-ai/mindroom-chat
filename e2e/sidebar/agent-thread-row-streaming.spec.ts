import type { Locator, Page } from '@playwright/test';
import {
  expect,
  openLobby,
  openNewSession,
  startThread,
  test,
  uniqueWord,
  waitForThreadEvent,
  type AgentStack,
} from '../helpers/agentStack';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// L4-F029: while an agent streams a reply, the thread's row in the sidebar's THREADS list shows
// that it streams, as the thread's Compact card does: a pulsing dot, and "Agent streaming" in the
// row's accessible name. The dot leaves when the reply finishes.
test.describe.configure({ timeout: 420_000 });

const threadRow = (page: Page, word: string) =>
  page.locator('button[aria-label^="Open thread:"]').filter({ hasText: word }).first();

/** Animations running in the row: the streaming dot pulses. */
const rowAnimations = (row: Locator): Promise<number> =>
  row.evaluate((element) => element.getAnimations({ subtree: true }).length);

const rowStreamsWhileAgentStreams = async (page: Page, stack: AgentStack, engine: string) => {
  await openLobby(page, stack);
  // The lobby is in the stack's space, whose sidebar lists its threads.
  await page.getByRole('button', { name: /^MindRoom(,|$)/ }).click();
  const word = uniqueWord('rowstream');
  // 400 words, one every quarter second: long enough to look while it streams on a loaded machine.
  const rootId = await startThread(stack, `${word} #stopme tell me more`);
  await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.content['io.mindroom.stream_status'] === 'streaming',
    { timeout: 60_000, description: 'the reply streaming' }
  );
  const row = threadRow(page, word);
  await expect(row).toHaveAttribute('aria-label', /Agent streaming/, { timeout: 20_000 });
  await expect.poll(() => rowAnimations(row)).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath(`row-streaming-${engine}.png`) });

  await waitForThreadEvent(
    stack,
    rootId,
    (event) => event.content['io.mindroom.stream_status'] === 'completed',
    { timeout: 200_000, description: 'the reply finishing' }
  );
  await expect(row).not.toHaveAttribute('aria-label', /Agent streaming/, { timeout: 20_000 });
  expect(await rowAnimations(row)).toBe(0);
};

test('a sidebar thread row shows that its agent streams', async ({ page, stack }) => {
  await rowStreamsWhileAgentStreams(page, stack, 'chromium');
});

test('a sidebar thread row shows that its agent streams (WebKit)', async ({ stack, baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const webkit = await launchWebKit();
  try {
    const page = await openNewSession(webkit, stack, {
      baseURL,
      viewport: { width: 1440, height: 900 },
    });
    await rowStreamsWhileAgentStreams(page, stack, 'webkit');
  } finally {
    await webkit.close();
  }
});
