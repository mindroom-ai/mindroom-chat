import { expect, test } from '@playwright/test';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  createDefaultThreadFilterState,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Compact reads no message of the room's main timeline by being open (Escape, Mark as Read and a
// view switch do). A room with no message yet shows its empty timeline under the bar until the
// first message makes a card; that first arrival must not be read either. The reader opens an
// empty people room stored in Compact, a colleague sends three messages a second apart, and none
// of them gets the reader's receipt: the server still counts 3, and the three cards stay unread.
const PASSWORD = 'compact-empty-room-password';
const RUN = Date.now().toString(36);

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts; scrollbars are shown, as for readers.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});
test.describe.configure({ timeout: 180_000 });

const registerAndLogin = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `cer_${name}_${RUN}`;
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

type JoinedRoomSync = {
  unread_notifications?: { notification_count?: number };
  ephemeral?: { events?: Array<{ type: string; content: unknown }> };
};
type ReceiptContent = Record<string, Record<string, Record<string, { thread_id?: string }>>>;

/** The reader's receipts in the room (event ID to thread), and the room's main count. */
const readState = async (session: MatrixSession, roomId: string) => {
  const sync = await matrixFetch<{ rooms?: { join?: Record<string, JoinedRoomSync> } }>(
    HOMESERVER,
    '/sync?timeout=0',
    { accessToken: session.accessToken }
  );
  const joined = sync.rooms?.join?.[roomId];
  const receipts: Record<string, string> = {};
  for (const event of joined?.ephemeral?.events ?? []) {
    if (event.type !== 'm.receipt') continue;
    for (const [eventId, byType] of Object.entries(event.content as ReceiptContent)) {
      const receipt =
        byType['m.read']?.[session.userId] ?? byType['m.read.private']?.[session.userId];
      if (receipt) receipts[eventId] = receipt.thread_id ?? 'unthreaded';
    }
  }
  return { receipts, count: joined?.unread_notifications?.notification_count ?? 0 };
};

test('Compact reads none of the first messages that arrive in an open, empty room', async ({
  page,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  const reader = await registerAndLogin('reader');
  const colleague = await registerAndLogin('colleague');
  const roomId = await createRoom(HOMESERVER, colleague.accessToken, {
    name: 'Venue shortlist',
    invite: [reader.userId],
  });
  await joinRoom(HOMESERVER, reader.accessToken, roomId);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await expectLoggedInShellStable(page);
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expect(page.locator('[data-compact-room-without-threads]')).toBeVisible({
    timeout: 30_000,
  });

  const bodies = [
    'The riverside hall has the date free, but only until six.',
    'The old library quoted twice what we paid last year.',
    'The rooftop terrace needs a rain plan, so I would leave it out.',
  ];
  const messageIds: string[] = [];
  for (const body of bodies) {
    // eslint-disable-next-line no-await-in-loop
    const eventId = await sendRoomMessage(HOMESERVER, colleague.accessToken, roomId, {
      msgtype: 'm.text',
      body,
    });
    messageIds.push(eventId);
    // eslint-disable-next-line no-await-in-loop
    await expect(page.locator(`[data-thread-root-id="${eventId}"]`)).toBeVisible({
      timeout: 15_000,
    });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1_000);
  }
  await page.waitForTimeout(2_000);

  const { receipts, count } = await readState(reader, roomId);
  const readMessages = messageIds.filter((id) => receipts[id] !== undefined);
  await page.screenshot({ path: testInfo.outputPath('compact-empty-room-arrivals.png') });
  expect(readMessages, 'messages with a receipt of the reader').toEqual([]);
  expect(count, "the room's main count on the server").toBe(3);
  await expect(
    page.locator(
      messageIds.map((id) => `[data-thread-root-id="${id}"][data-thread-unread="true"]`).join(', ')
    ),
    'unread cards'
  ).toHaveCount(3);
});
