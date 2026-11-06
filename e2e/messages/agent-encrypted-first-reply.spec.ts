import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { composer, expect, test, uniqueWord, type AgentStack } from '../helpers/agentStack';
import { matrixFetch } from '../helpers/matrix';

// Regression (L5-F009): the first agent reply in a new encrypted room. The agent shares the room's
// key with the reader's device in the same moment it sends the reply, so the reply often arrives
// before its key and decrypts a moment later. The reply must then show its streamed text and the
// Stop button, never "Unsupported message" with the agent's 🛑 as a plain reaction chip.
test.describe.configure({ timeout: 300_000 });

/** An encrypted room of the tester with the helper and the router, once both joined it. */
const createEncryptedRoom = async (stack: AgentStack): Promise<string> => {
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(
    stack.homeserver,
    '/createRoom',
    {
      method: 'POST',
      accessToken: stack.tester.accessToken,
      body: JSON.stringify({
        name: uniqueWord('Secure '),
        preset: 'private_chat',
        invite: [stack.agents.helper, stack.agents.router],
        initial_state: [
          {
            type: 'm.room.encryption',
            state_key: '',
            content: { algorithm: 'm.megolm.v1.aes-sha2' },
          },
        ],
      }),
    }
  );
  await expect
    .poll(
      async () => {
        const { joined } = await matrixFetch<{ joined: Record<string, unknown> }>(
          stack.homeserver,
          `/rooms/${encodeURIComponent(roomId)}/joined_members`,
          { accessToken: stack.tester.accessToken }
        );
        return !!joined[stack.agents.helper] && !!joined[stack.agents.router];
      },
      { timeout: 90_000, intervals: [500, 1000], message: 'the agents join the encrypted room' }
    )
    .toBe(true);
  return roomId;
};

/** Sends "@Helper <text>" with the mention Tab takes from the composer's suggestions. */
const mentionHelper = async (page: Page, stack: AgentStack, text: string): Promise<void> => {
  await composer(page).click();
  await page.keyboard.type('@Hel');
  await expect(page.getByText(stack.agents.helper, { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.keyboard.press('Tab');
  await page.keyboard.type(` ${text}`);
  await page.keyboard.press('Enter');
};

test('the first reply in a new encrypted room streams its text with a Stop button', async ({
  page,
  stack,
}) => {
  const decryptLog: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/decrypt|room key|to-device/i.test(text)) decryptLog.push(text.slice(0, 400));
  });
  const roomId = await createEncryptedRoom(stack);
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
});
