import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { joinRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { setRoomCompact } from '../helpers/roomViewSwitch';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A member who was kicked, banned and unbanned (P2-lane5-F005): the kick, the ban and the leave
// that lifts it carry no name, and the member is no longer in the room. Their earlier messages
// keep the name they had: the thread card's preview and the thread's message header read it,
// never their user ID or its localpart. Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE
// names Playwright's WebKit, in WebKit, against the disposable homeserver.
// DEPARTED_NAME_SHOTS=<directory> saves the card and the thread.
const PASSWORD = 'departed-sender-name-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.DEPARTED_NAME_SHOTS;
const DEPARTED_NAME = 'Dana Member';

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const setDisplayName = (user: DisposableUser, displayname: string) =>
  matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(user.userId)}/displayname`, {
    method: 'PUT',
    accessToken: user.accessToken,
    body: JSON.stringify({ displayname }),
  });

const moderate = (host: DisposableUser, roomId: string, action: string, userId: string) =>
  matrixFetch(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/${action}`, {
    method: 'POST',
    accessToken: host.accessToken,
    body: JSON.stringify({ user_id: userId, reason: `${action} probe` }),
  });

const departedKeepsName = async (page: Page, browserName: string) => {
  const host = await registerDisposableUser(`dsn_host_${browserName}_${RUN}`, PASSWORD);
  const member = await registerDisposableUser(`dsn_member_${browserName}_${RUN}`, PASSWORD);
  await setDisplayName(host, 'Ari Host');
  await setDisplayName(member, DEPARTED_NAME);
  const roomName = `Departed probe ${browserName} ${RUN}`;
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: host.accessToken,
    body: JSON.stringify({ preset: 'private_chat', name: roomName, invite: [member.userId] }),
  });
  await joinRoom(HOMESERVER, member.accessToken, roomId);
  const rootBody = `Release checklist for the departed probe ${browserName}`;
  const replyBody = `Probe reply from the member who left ${browserName}`;
  const rootId = await sendRoomMessage(HOMESERVER, host.accessToken, roomId, {
    msgtype: 'm.text',
    body: rootBody,
  });
  await sendRoomMessage(HOMESERVER, member.accessToken, roomId, {
    msgtype: 'm.text',
    body: replyBody,
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  await moderate(host, roomId, 'kick', member.userId);
  await moderate(host, roomId, 'ban', member.userId);
  await moderate(host, roomId, 'unban', member.userId);

  await loginWithPassword(page, { homeserver: HOMESERVER, ...host });
  await page
    .getByRole('link', { name: new RegExp(roomName) })
    .first()
    .click({ timeout: 60_000 });
  await setRoomCompact(page, true);
  const card = page.locator(`[data-compact-room-view] [data-thread-root-id="${rootId}"]`);
  await expect(card).toContainText(replyBody, { timeout: 30_000 });
  await expect(card).toContainText(DEPARTED_NAME);
  await expect(card).not.toContainText(member.userId);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/departed-card-${browserName}.png` });

  await card.getByText(rootBody).first().click();
  const reply = page.getByText(replyBody, { exact: true }).last();
  await expect(reply).toBeVisible({ timeout: 30_000 });
  const localpart = member.userId.slice(1).split(':')[0] ?? member.username;
  await expect(page.getByText(localpart, { exact: true })).toHaveCount(0);
  await expect(page.getByText(DEPARTED_NAME, { exact: true }).first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/departed-thread-${browserName}.png` });
};

test('a kicked, banned and unbanned member keeps their name on earlier messages (Chromium)', async ({
  page,
  browserName,
}) => {
  test.setTimeout(180_000);
  await departedKeepsName(page, browserName);
});

test('a kicked, banned and unbanned member keeps their name on earlier messages (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    departedKeepsName(page, 'webkit')
  );
});
