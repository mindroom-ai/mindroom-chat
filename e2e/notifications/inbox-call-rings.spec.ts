import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { CHROMIUM_WITH_SCROLLBARS } from '../helpers/disposableAccounts';
import {
  joinRoom,
  loginToMatrix,
  matrixFetch,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';

// A call ring (MSC4075 `org.matrix.msc4075.rtc.notification` with `notification_type: ring`)
// notifies the person it rings, so the server lists it among their notifications. The Inbox shows
// it as a call: the caller, then "Voice call" or "Video call" with its icon, never as an
// "Unsupported message". A colleague rings the reader twice (voice, then video) and writes once;
// the Inbox lists all three. Set INBOX_RING_SHOTS to a directory to save a screenshot.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'inbox-call-rings-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.INBOX_RING_SHOTS;

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });
test.describe.configure({ timeout: 180_000 });

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const registerPerson = async (
  name: string,
  displayName: string
): Promise<MatrixSession & { username: string }> => {
  const username = `icr_${name}_${RUN}`;
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
  const session = await loginToMatrix(HOMESERVER, username, PASSWORD);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });
  return { ...session, username };
};

/** Rings `callee` in `roomId` as a call client does when it starts a call there. */
const ring = (caller: MatrixSession, roomId: string, callee: string, video: boolean) =>
  matrixFetch<{ event_id: string }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(
      roomId
    )}/send/org.matrix.msc4075.rtc.notification/ring${Date.now()}${Math.random()}`,
    {
      method: 'PUT',
      accessToken: caller.accessToken,
      body: JSON.stringify({
        notification_type: 'ring',
        'm.mentions': { user_ids: [callee] },
        'm.call.intent': video ? 'video' : 'audio',
        sender_ts: Date.now(),
        lifetime: 30_000,
      }),
    }
  ).then((sent) => sent.event_id);

/** The Inbox's highlighted rows: mentions and rings. */
const inboxRows = (page: Page) => page.locator('[data-notification-highlight]');

test('the Inbox lists call rings as calls, not as unsupported messages', async ({
  page,
}, testInfo) => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  const reader = await registerPerson('reader', 'Robin Reader');
  const caller = await registerPerson('caller', 'Casey Caller');
  const roomId = await createRoom(HOMESERVER, caller.accessToken, {
    name: 'Casey and Robin',
    invite: [reader.userId],
  });
  await joinRoom(HOMESERVER, reader.accessToken, roomId);
  await ring(caller, roomId, reader.userId, false);
  await ring(caller, roomId, reader.userId, true);
  await sendRoomMessage(HOMESERVER, caller.accessToken, roomId, {
    msgtype: 'm.text',
    body: `${reader.userId} sorry I missed you, call me back when you can.`,
    'm.mentions': { user_ids: [reader.userId] },
  });
  // The server lists both rings among the reader's notifications.
  const listed = await matrixFetch<{ notifications: Array<{ event: { type: string } }> }>(
    HOMESERVER,
    '/notifications',
    { accessToken: reader.accessToken }
  );
  expect(
    listed.notifications.filter(
      (entry) => entry.event.type === 'org.matrix.msc4075.rtc.notification'
    ),
    'rings among the notifications'
  ).toHaveLength(2);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await page.goto('/inbox/notifications/');
  await expect(inboxRows(page).filter({ hasText: 'call me back' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(inboxRows(page)).toHaveCount(3);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/inbox-call-rings.png` });
  await page.screenshot({ path: testInfo.outputPath('inbox-call-rings.png') });

  await expect(inboxRows(page).filter({ hasText: 'Unsupported message' })).toHaveCount(0);
  await expect(inboxRows(page).filter({ hasText: 'Voice call' })).toHaveCount(1);
  await expect(inboxRows(page).filter({ hasText: 'Video call' })).toHaveCount(1);
  for (const kind of ['Voice call', 'Video call']) {
    // eslint-disable-next-line no-await-in-loop
    await expect(inboxRows(page).filter({ hasText: kind }).locator('b').first()).toContainText(
      'Casey Caller'
    );
  }
});
