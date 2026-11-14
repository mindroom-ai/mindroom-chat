import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { joinRoom, matrixFetch, sendRoomMessage, type MatrixSession } from '../helpers/matrix';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Activity's Mark all read against the disposable homeserver of `just hs-up` (or a slot of
// scripts/e2e-slot.sh): another account's thread replies mention the reader, and Mark all read
// clears them in Activity, on the server and in the sidebar. Each run registers its own two
// accounts.
const PASSWORD = 'activity-mark-read-spec-password';
const RUN = Date.now().toString(36);

const registerAndLogin = (name: string): Promise<MatrixSession & { username: string }> =>
  registerDisposableUser(`amr_${name}_${RUN}`, PASSWORD);

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
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('Mark all read in Activity clears the threads it lists, on the server too', async ({
  page,
}) => {
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

  await openPath(page, '/activity/');
  const list = page.getByRole('navigation', { name: 'Activity' });
  // One row per thread, each naming the mention.
  const mentions = list.locator('[data-activity-row="mention"]');
  await expect(mentions).toHaveCount(2, { timeout: 30_000 });
  await expect(mentions.filter({ hasText: 'the evening crane is booked too' })).toContainText(
    'mentioned you'
  );
  await expect(mentions.filter({ hasText: 'berth four is free on Friday' })).toContainText(
    'mentioned you'
  );
  const rail = page.getByRole('navigation', { name: 'Main', exact: true });
  await expect(rail.getByRole('button', { name: 'Activity, 2 unread', exact: true })).toBeVisible();

  await list.getByRole('button', { name: 'Mark all read', exact: true }).click();

  // Each thread's receipt reads its root and its replies: the server counts every notification of
  // the room as read.
  await expect
    .poll(() => serverNotifications(reader, roomId), { timeout: 15_000 })
    .toEqual(Array(5).fill(true));
  // Activity keeps the threads listed, read, and the bell's count goes.
  await expect(rail.getByRole('button', { name: 'Activity', exact: true })).toBeVisible();
  await expect(list.locator('[data-activity-row]')).toHaveCount(2);
  await list.getByRole('switch', { name: 'Unread' }).click();
  await expect(list.locator('[data-activity-row]')).toHaveCount(0);
  // The sidebar shows the room read: no count, and no unread mark for its roots by another
  // account.
  await openPath(page, '/home/');
  await expect(roomLink).toBeVisible();
  await expect(roomLink).not.toContainText(/\d/);
  await expect(page.locator('[data-highlight]').filter({ has: roomLink })).toHaveAttribute(
    'data-highlight',
    'false'
  );
});
