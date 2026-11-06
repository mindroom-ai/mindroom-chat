import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  composer,
  createEncryptedAgentRoom,
  expect,
  mentionHelper,
  openNewSession,
  test,
  uniqueWord,
  type AgentStack,
} from '../helpers/agentStack';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Set E2EE_SHOTS=<directory> to save the streaming reply.
const SHOTS = process.env.E2EE_SHOTS;

// Regression (L5-F009): the first agent reply in a new encrypted room. The agent shares the room's
// key with the reader's device in the same moment it sends the reply, so the reply often arrives
// before its key and decrypts a moment later. The reply must then show its streamed text and the
// Stop button, never "Unsupported message" with the agent's 🛑 as a plain reaction chip.
test.describe.configure({ timeout: 300_000 });

const firstReplyStreams = async (page: Page, stack: AgentStack): Promise<void> => {
  const decryptLog: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/decrypt|room key|to-device/i.test(text)) decryptLog.push(text.slice(0, 400));
  });
  const roomId = await createEncryptedAgentRoom(stack, 'Secure desk');
  await page.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
  await expect(composer(page)).toBeVisible({ timeout: 90_000 });

  // 400 words, one every quarter second: the stream runs long enough to watch it.
  await mentionHelper(page, stack, `#stopme ${uniqueWord('first')}`);

  const unsupported = page.getByText('Unsupported message');
  const stop = page.getByRole('button', { name: 'Stop', exact: true });
  // What the reader saw each half second, for a failure's report.
  const samples: string[] = [];
  const started = Date.now();
  const sample = async () => {
    const text = await page
      .locator('[data-message-id]')
      .allInnerTexts()
      .catch(() => []);
    samples.push(`${Date.now() - started}ms ${text.join(' | ').replace(/\s+/g, ' ').slice(-300)}`);
  };
  try {
    for (let index = 0; index < 12; index += 1) {
      await sample();
      await page.waitForTimeout(500);
    }
    await expect(stop).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/\bword5\b/).first()).toBeVisible({ timeout: 30_000 });
    await expect(unsupported).toHaveCount(0);
    if (SHOTS) {
      const engine = page.context().browser()?.browserType().name() ?? 'browser';
      await page.screenshot({ path: `${SHOTS}/first-reply-${engine}.png` });
    }
  } finally {
    writeFileSync(
      test.info().outputPath('reader.log'),
      `${samples.join('\n')}\n\n${decryptLog.join('\n')}\n`
    );
  }

  await stop.click();
  await expect(page.getByText('[Response cancelled by user]').first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(unsupported).toHaveCount(0);
};

const TITLE = 'the first reply in a new encrypted room streams its text with a Stop button';

test(TITLE, async ({ page, stack }) => {
  await firstReplyStreams(page, stack);
});

test(`${TITLE} (WebKit)`, async ({ stack, baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const webkit = await launchWebKit();
  try {
    await firstReplyStreams(await openNewSession(webkit, stack, { baseURL }), stack);
  } finally {
    await webkit.close();
  }
});
