import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Escape in a room reads the room's own messages and leaves its threads alone: the reader starts
// three threads that an agent and a colleague answer, and a colleague's message waits in the
// room. After Escape the three thread cards are still unread, and the reader's receipt for the
// room's main timeline sits on the colleague's message.
const PASSWORD = 'room-escape-threads-password';
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

const registerAndLogin = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `res_${name}_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

type ReceiptContent = Record<
  string,
  Record<string, Record<string, { ts?: number; thread_id?: string }>>
>;

/** The thread scope of the reader's receipt on `eventId`, as the server reports it in a sync. */
const receiptThreadOn = async (
  session: MatrixSession,
  roomId: string,
  eventId: string
): Promise<string | null | undefined> => {
  const sync = await matrixFetch<{
    rooms?: {
      join?: Record<string, { ephemeral?: { events?: Array<{ type: string; content: unknown }> } }>;
    };
  }>(HOMESERVER, '/sync?timeout=0', { accessToken: session.accessToken });
  const events = sync.rooms?.join?.[roomId]?.ephemeral?.events ?? [];
  for (const event of events) {
    if (event.type !== 'm.receipt') continue;
    const byType = (event.content as ReceiptContent)[eventId];
    const receipt =
      byType?.['m.read']?.[session.userId] ?? byType?.['m.read.private']?.[session.userId];
    if (receipt) return receipt.thread_id ?? null;
  }
  return undefined;
};

test('Escape in a room reads its main timeline and leaves every thread unread', async ({
  page,
}, testInfo) => {
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
  const threads: Array<[MatrixSession, string]> = [
    [agent, 'Refund request from the Berlin office'],
    [colleague, 'Login loop on the iPad app'],
    [agent, 'Export to CSV drops the last row'],
  ];
  const rootIds: string[] = [];
  for (const [replier, body] of threads) {
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body,
    });
    rootIds.push(rootId);
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, replier.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Looking into it now, I will report back within the hour.',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
  }
  // The room's own newest message, which the reader has not read either.
  const roomMessageId = await sendRoomMessage(HOMESERVER, colleague.accessToken, roomId, {
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
  await expect(page.locator('[data-thread-root-id]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
  // Compact view shows the room's own message as a card too; only the thread cards count here.
  const unreadThreadCards = page.locator(
    rootIds.map((id) => `[data-thread-root-id="${id}"][data-thread-unread="true"]`).join(', ')
  );
  await expect(unreadThreadCards).toHaveCount(3);

  // Escape with nothing focused: the room's Escape focuses the composer and reads the room.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect
    .poll(() => receiptThreadOn(reader, roomId, roomMessageId), { timeout: 15_000 })
    .toBe('main');
  await page.waitForTimeout(2_000);
  await expect(unreadThreadCards, 'unread thread cards after Escape').toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('room-escape-threads-unread.png') });
});
