import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Escape closes the thread filter bar's Preset list and Thread statistics and hands the focus back
// to their buttons, without reading anything: the reader starts four threads that an agent and a
// colleague answer, has read two of them, and a colleague's message waits in the room; the three
// unread cards stay unread.
const PASSWORD = 'thread-filter-escape-password';
const RUN = Date.now().toString(36);

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});
test.describe.configure({ timeout: 180_000 });

const registerAndLogin = (name: string): Promise<MatrixSession & { username: string }> =>
  registerDisposableUser(`tfe_${name}_${RUN}`, PASSWORD);

test('Escape closes the filter bar panels without reading the threads', async ({ page }) => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  const reader = await registerAndLogin('reader');
  const colleague = await registerAndLogin('colleague');
  const agent = await registerAgentAccount(HOMESERVER, 'triage');
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Support triage',
    invite: [colleague.userId, agent.userId],
  });
  await joinRoom(HOMESERVER, colleague.accessToken, roomId);
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  // The reader starts every thread, so only the replies the reader has not read make one unread.
  const threads: Array<[MatrixSession, string]> = [
    [agent, 'Refund request from the Berlin office'],
    [colleague, 'Login loop on the iPad app'],
    [colleague, 'Invoice PDF shows the wrong VAT number'],
    [agent, 'Export to CSV drops the last row'],
  ];
  for (const [replier, body] of threads) {
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body,
    });
    // eslint-disable-next-line no-await-in-loop
    const replyId = await sendRoomMessage(HOMESERVER, replier.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Looking into it now.',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
    if (body.startsWith('Refund') || body.startsWith('Export')) {
      // The reader has read these threads to their end.
      // eslint-disable-next-line no-await-in-loop
      await matrixFetch(
        HOMESERVER,
        `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(replyId)}`,
        {
          method: 'POST',
          accessToken: reader.accessToken,
          body: JSON.stringify({ thread_id: rootId }),
        }
      );
    }
  }
  // A colleague's message in the room itself, which the reader has not read either.
  await sendRoomMessage(HOMESERVER, colleague.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Morning all, standup moves to 10:30 today.',
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const cards = page.locator('[data-thread-root-id]');
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
  const unreadCards = page.locator('[data-thread-root-id][data-thread-unread="true"]');
  await expect(unreadCards).toHaveCount(3);
  const unread = 3;

  // Escape closes the Preset list and the statistics and does nothing else: the room's own
  // Escape focuses the composer, which reads the room and every thread in it.
  const bar = page.getByRole('toolbar').filter({ has: page.locator('[data-thread-count]') });
  const advanced = bar.locator('[data-thread-filter-mode-switch]');
  if ((await advanced.getAttribute('aria-pressed')) !== 'true') await advanced.click();
  for (const [trigger, panel] of [
    ['[data-preset-button]', '[data-preset-dropdown]'],
    ['[data-info-button]', '[data-info-popover]'],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop
    await bar.locator(trigger).click();
    // eslint-disable-next-line no-await-in-loop
    await expect(page.locator(panel)).toBeVisible();
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Escape');
    // eslint-disable-next-line no-await-in-loop
    await expect(page.locator(panel)).toHaveCount(0);
    // eslint-disable-next-line no-await-in-loop
    await expect(bar.locator(trigger)).toBeFocused();
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(3_000);
    // eslint-disable-next-line no-await-in-loop
    await expect(unreadCards, `unread threads after Escape in ${panel}`).toHaveCount(unread);
  }
});
