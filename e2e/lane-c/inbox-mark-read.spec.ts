import { expect, test, type Page, type Request } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  joinRoom,
  loginToMatrix,
  matrixFetch,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { createRoom } from './createRoom';

// The Inbox's Mark as Read against the disposable homeserver of `just hs-up` (or a slot of
// scripts/e2e-slot.sh): another account's thread replies notify the reader, and Mark as Read on
// their room clears them in the Inbox, on the server and in the sidebar. Each run registers its own
// two accounts.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'inbox-mark-read-spec-password';
const RUN = Date.now().toString(36);

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

const registerAndLogin = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `imr_${name}_${RUN}`;
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

const mentionInThread = (rootId: string, userId: string, text: string) => ({
  msgtype: 'm.text',
  body: `${userId} ${text}`,
  'm.mentions': { user_ids: [userId] },
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

type ServerNotification = { room_id: string; read: boolean; event: { event_id: string } };

/** The reader's notifications of one room as the server lists them: event ID and read flag. */
const serverNotifications = async (session: MatrixSession, roomId: string) => {
  const { notifications } = await matrixFetch<{ notifications: ServerNotification[] }>(
    HOMESERVER,
    '/notifications?limit=50',
    { accessToken: session.accessToken }
  );
  return notifications
    .filter((notification) => notification.room_id === roomId)
    .map((notification) => notification.read);
};

/** Moves within the app without reloading it, as its own links do. */
const openPath = (page: Page, path: string) =>
  page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('Mark as Read in the Inbox clears the thread notifications of its room', async ({ page }) => {
  test.setTimeout(240_000);
  const reader = await registerAndLogin('reader');
  const writer = await registerAndLogin('writer');
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Harbor Plans',
    invite: [writer.userId],
  });
  await joinRoom(HOMESERVER, writer.accessToken, roomId);
  const firstRoot = await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Crane schedule',
  });
  const secondRoot = await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Berth assignments',
  });

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });

  // The replies arrive while the reader is signed in, as an agent's answers do.
  await sendRoomMessage(
    HOMESERVER,
    writer.accessToken,
    roomId,
    mentionInThread(firstRoot, reader.userId, 'the morning crane is booked')
  );
  await sendRoomMessage(
    HOMESERVER,
    writer.accessToken,
    roomId,
    mentionInThread(secondRoot, reader.userId, 'berth four is free on Friday')
  );
  await sendRoomMessage(
    HOMESERVER,
    writer.accessToken,
    roomId,
    mentionInThread(firstRoot, reader.userId, 'the evening crane is booked too')
  );
  // Two roots and three replies, all unread.
  await expect.poll(() => serverNotifications(reader, roomId)).toEqual(Array(5).fill(false));

  const roomLink = page.getByRole('link', { name: /Harbor Plans/ });
  await expect(roomLink).toContainText('5', { timeout: 30_000 });

  await openPath(page, '/inbox/notifications/');
  const mentions = page.locator('[data-notification-highlight]');
  await expect(mentions).toHaveCount(3, { timeout: 30_000 });
  const unreadDots = page.getByRole('img', { name: 'Unread', exact: true });
  await expect(unreadDots).toHaveCount(5);

  const receipts: { path: string; body: unknown }[] = [];
  const recordReceipt = (request: Request) => {
    const { pathname } = new URL(request.url());
    if (pathname.includes('/receipt/')) {
      receipts.push({ path: decodeURIComponent(pathname), body: request.postDataJSON() });
    }
  };
  page.on('request', recordReceipt);

  await page.getByRole('button', { name: 'Mark as Read', exact: true }).click();

  // One unthreaded receipt reads the room with its threads: the server counts every notification
  // of the room as read.
  await expect
    .poll(() => serverNotifications(reader, roomId), { timeout: 15_000 })
    .toEqual(Array(5).fill(true));
  expect(receipts).toEqual([{ path: expect.stringContaining('/receipt/m.read/$'), body: {} }]);
  // The Inbox shows them as read and keeps them listed; the room's chip goes away.
  await expect(unreadDots).toHaveCount(0);
  await expect(mentions).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Mark as Read', exact: true })).toHaveCount(0);
  // The sidebar no longer counts the room's messages or thread replies.
  await openPath(page, '/home/');
  await expect(roomLink).toBeVisible();
  await expect(roomLink).not.toContainText(/\d/);
});
