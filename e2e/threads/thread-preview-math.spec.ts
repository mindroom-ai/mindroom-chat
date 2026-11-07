import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import {
  createDefaultThreadFilterState,
  joinRoom,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

// A thread's card showed the math of its messages as TeX source ("$$ x = \frac{-b \pm ...}{2a} $$");
// it reads each formula as plain text. The test saves a screenshot of the thread list in its
// output directory.
const PASSWORD = 'thread-preview-math-spec-password';
const RUN = Date.now().toString(36);

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a thread card reads the math of its messages as plain text', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const reader = await registerDisposableUser(`tpm_reader_${RUN}`, PASSWORD);
  const agent = await registerDisposableUser(`mindroom_algebra_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Algebra help',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'How do I solve $ax^2 + bx + c = 0$ for $x$?',
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Use the quadratic formula:\n\n$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$\n\nwhenever $a \\neq 0$.',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });

  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const card = page.locator(`[data-thread-root-id="${rootId}"]`).first();
  // The card previews the reply once it names the condition, as TeX source or as text.
  await expect(card).toContainText('whenever', { timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath('thread-preview-math.png') });
  await expect(card).toContainText('How do I solve ax^2 + bx + c = 0 for x?');
  await expect(card).toContainText(
    'Use the quadratic formula: x = ((-b ± √(b^2 - 4ac))/(2a)) whenever a ≠ 0.'
  );
});
