import { writeFileSync } from 'node:fs';
import type { Browser, Page } from '@playwright/test';
import {
  composer,
  createEncryptedAgentRoom,
  expect,
  mentionHelper,
  openNewSession,
  test,
  type AgentStack,
} from '../helpers/agentStack';
import { matrixFetch } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Regression (P2-e2ee-F002): a device without the keys of an encrypted room showed an agent's
// stopped reply as streaming for good: "streaming" on the thread's card and a streaming dot on its
// sidebar row. The reply's terminal edit says "cancelled" in the clear (MindRoom keeps the stream
// status outside the encrypted payload), and a device that cannot decrypt it must take the reply
// as finished.
test.describe.configure({ timeout: 300_000 });

// Set E2EE_SHOTS=<directory> to save the keyless device's room.
const SHOTS = process.env.E2EE_SHOTS;

/** The reader's own message in the room, which roots the reply's thread. */
const readerRoot = async (stack: AgentStack, roomId: string): Promise<string> => {
  type Raw = { event_id: string; sender: string; content: { 'm.relates_to'?: unknown } };
  const { chunk } = await matrixFetch<{ chunk: Raw[] }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=100`,
    { accessToken: stack.tester.accessToken }
  );
  const root = chunk.find(
    (event) => event.sender === stack.tester.userId && !event.content['m.relates_to']
  );
  if (!root) throw new Error("The reader's message is not in the room");
  return root.event_id;
};

/** The reader asks the helper in a new encrypted room and stops the reply after a few words. */
const stoppedReply = async (page: Page, stack: AgentStack): Promise<string> => {
  const roomId = await createEncryptedAgentRoom(stack, 'Secure stopped');
  await page.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
  await expect(composer(page)).toBeVisible({ timeout: 90_000 });
  // 400 words, one every quarter second.
  await mentionHelper(page, stack, '#stopme stop this one');
  await expect(page.getByText(/\bword5\b/).first()).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByText('[Response cancelled by user]').first()).toBeVisible({
    timeout: 60_000,
  });
  return roomId;
};

/** A new session of the tester, without the room's keys, shows the stopped reply as finished. */
const keylessShowsFinished = async (
  browser: Browser,
  stack: AgentStack,
  baseURL: string | undefined,
  roomId: string
) => {
  const fresh = await openNewSession(browser, stack, {
    baseURL,
    viewport: { width: 1440, height: 900 },
  });
  const log: string[] = [];
  try {
    await fresh.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
    const rootId = await readerRoot(stack, roomId);
    const card = fresh.locator(`[data-thread-root-id="${rootId}"]`).first();
    await expect(card).toBeVisible({ timeout: 90_000 });
    // The card settles: it never says "streaming" for 15 seconds in a row.
    let held = 0;
    await expect
      .poll(
        async () => {
          const text = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ');
          log.push(text);
          held = /\bstreaming\b/i.test(text) ? 0 : held + 1;
          return held >= 15;
        },
        { timeout: 90_000, intervals: [1000], message: 'the stopped reply shows as finished' }
      )
      .toBe(true);
    const engine = fresh.context().browser()?.browserType().name() ?? 'browser';
    if (SHOTS) await fresh.screenshot({ path: `${SHOTS}/keyless-stopped-${engine}.png` });

    // Regression (P2-e2ee-F004): the reply's row says it cannot be decrypted, once; it showed
    // "A newer edit couldn't be decrypted" under that too.
    await fresh.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await expect(fresh.getByText(/Couldn.t decrypt this message/).first()).toBeVisible({
      timeout: 90_000,
    });
    await fresh.waitForTimeout(3_000);
    if (SHOTS) await fresh.screenshot({ path: `${SHOTS}/keyless-thread-${engine}.png` });
    await expect(fresh.getByText(/A newer edit couldn.t be decrypted/)).toHaveCount(0);
    // Regression (P2-e2ee-F003): the thread has no approval, but its reply could not be
    // decrypted, and a bar said "Some approval history could not be decrypted."
    await expect(fresh.getByText(/approval history could not be decrypted/)).toHaveCount(0);
  } finally {
    writeFileSync(test.info().outputPath('card.log'), `${log.join('\n')}\n`);
    await fresh.context().close();
  }
};

test('a device without the keys shows a stopped encrypted reply as finished', async ({
  page,
  stack,
  browser,
  baseURL,
}) => {
  const roomId = await stoppedReply(page, stack);
  await keylessShowsFinished(browser, stack, baseURL, roomId);
});

test('a device without the keys shows a stopped encrypted reply as finished (WebKit)', async ({
  page,
  stack,
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const roomId = await stoppedReply(page, stack);
  const webkit = await launchWebKit();
  try {
    await keylessShowsFinished(webkit, stack, baseURL, roomId);
  } finally {
    await webkit.close();
  }
});
