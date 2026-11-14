import { expect, test, type Page } from '@playwright/test';
import { getHomeserver } from '../env';
import { readSessionStore } from '../helpers/accounts';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, matrixFetch, seedRoomOverviewState } from '../helpers/matrix';

// Rooms this account was invited to, removed from, or moderates show the names the client knows:
// the invite and removal pages title the room by its name (from the invite's stripped state or the
// room's state), never by its raw ID; an invite opened while the homeserver cannot be reached
// shows the same card from the saved sync and refreshes itself once the server answers again; and
// after an unban the person keeps their name and is not described as kicked.
const PASSWORD = 'room-identity-spec-password';

// OFFLINE_IDENTITY_SHOTS=<directory> also saves screenshots of the checked states.
const SHOTS = process.env.OFFLINE_IDENTITY_SHOTS;
const shot = async (page: Page, name: string, browserName: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${browserName}.png` });
};

type Account = { username: string; userId: string; accessToken: string };

const register = async (prefix: string, displayname: string): Promise<Account> => {
  const homeserver = getHomeserver();
  const username = `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  await matrixFetch(homeserver, `/profile/${encodeURIComponent(body.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: body.access_token,
    body: JSON.stringify({ displayname }),
  });
  return { username, userId: body.user_id, accessToken: body.access_token };
};

const moderate = (
  owner: Account,
  roomId: string,
  action: 'kick' | 'ban' | 'unban',
  userId: string,
  reason?: string
) =>
  matrixFetch(getHomeserver(), `/rooms/${encodeURIComponent(roomId)}/${action}`, {
    method: 'POST',
    accessToken: owner.accessToken,
    body: JSON.stringify({ user_id: userId, ...(reason ? { reason } : {}) }),
  });

const signIn = async (page: Page, account: Account) => {
  await loginWithPassword(page, {
    homeserver: getHomeserver(),
    username: account.username,
    password: PASSWORD,
  });
};

const roomPath = (roomId: string) => `/home/${encodeURIComponent(roomId)}`;

/** Waits until the SDK's saved sync (what an offline start reads) holds `text`. */
const waitForSavedSync = async (page: Page, text: string) => {
  const { activeSessionId } = await readSessionStore(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          async ({ name, wanted }) => {
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open(name);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            // Room data and account data are saved in stores of their own.
            const read = (store: string) =>
              new Promise<string>((resolve, reject) => {
                const request = db.transaction(store).objectStore(store).getAll();
                request.onsuccess = () => resolve(JSON.stringify(request.result));
                request.onerror = () => reject(request.error);
              });
            try {
              const saved = await Promise.all(['sync', 'accountData'].map(read));
              return saved.some((json) => json.includes(wanted));
            } finally {
              db.close();
            }
          },
          { name: `matrix-js-sdk:web-sync-store::${activeSessionId}`, wanted: text }
        ),
      { message: `the saved sync holds ${text}`, timeout: 30_000 }
    )
    .toBe(true);
};

test.use({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });

test('an invite is titled by its room name, offline too, and refreshes when the server returns @webkit', async ({
  page,
  context,
  browserName,
}) => {
  test.setTimeout(120_000);
  const homeserver = getHomeserver();
  const inviter = await register('identity_inviter', 'Invite Sender');
  const invitee = await register('identity_invitee', 'Invite Reader');
  const roomName = `Invite identity ${Date.now().toString(36)}`;
  const roomId = await createRoom(homeserver, inviter.accessToken, {
    name: roomName,
    invite: [invitee.userId],
  });

  await signIn(page, invitee);
  await page.goto(roomPath(roomId));
  await expect(page.getByText('1 Member', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Invite Sender', { exact: true })).toBeVisible();
  // The header names the room, as the card does, rather than showing its ID.
  await expect(page.getByRole('heading', { level: 1, name: roomName, exact: true })).toBeVisible();
  await expect(page.getByText(roomId)).toHaveCount(0);

  await waitForSavedSync(page, roomId);

  // The homeserver stops answering this client; the page starts again from its saved sync.
  const homeserverRoutes = `${new URL(homeserver).origin}/**`;
  await context.route(homeserverRoutes, (route) => route.abort('connectionrefused'));
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: roomName, exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(roomId)).toHaveCount(0);
  await expect(page.getByText('Invite Sender', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Decline', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry room info' })).toHaveCount(0);
  await shot(page, 'invite-homeserver-unreachable', browserName);

  // Once the server answers again, the card catches up without a click.
  await context.unroute(homeserverRoutes);
  await expect(page.getByText('1 Member', { exact: true })).toBeVisible({ timeout: 45_000 });
  await shot(page, 'invite-recovered', browserName);
  await expect(page.getByRole('heading', { level: 1, name: roomName, exact: true })).toBeVisible();
});

test('a person removed from a room still sees its name in the header @webkit', async ({
  page,
  browserName,
}) => {
  test.setTimeout(90_000);
  const owner = await register('identity_owner', 'Room Keeper');
  const member = await register('identity_member', 'Removed Reader');
  const roomName = `Removal identity ${Date.now().toString(36)}`;
  const roomId = await createRoom(getHomeserver(), owner.accessToken, {
    name: roomName,
    invite: [member.userId],
  });
  await joinRoom(getHomeserver(), member.accessToken, roomId);

  await signIn(page, member);
  await page.goto(roomPath(roomId));
  await expect(page.getByRole('textbox').last()).toBeVisible({ timeout: 20_000 });
  await moderate(owner, roomId, 'kick', member.userId, 'Removal reason for the test');

  await expect(page.getByText('Removal reason for the test')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Room Keeper', { exact: true })).toBeVisible();
  await shot(page, 'removed-room-header', browserName);
  await expect(page.getByRole('heading', { level: 1, name: roomName, exact: true })).toBeVisible();
  await expect(page.getByText(roomId)).toHaveCount(0);
});

test('after an unban the person keeps their name and is not called kicked @webkit', async ({
  page,
  browserName,
}) => {
  test.setTimeout(90_000);
  const owner = await register('identity_mod', 'Room Moderator');
  const member = await register('identity_banned', 'Banned Person');
  const roomName = `Unban identity ${Date.now().toString(36)}`;
  const roomId = await createRoom(getHomeserver(), owner.accessToken, {
    name: roomName,
    invite: [member.userId],
  });
  // The sequence of the live finding: an invite withdrawn, then a ban, then an unban.
  await moderate(owner, roomId, 'kick', member.userId);
  await moderate(owner, roomId, 'ban', member.userId, 'Ban reason for the test');

  await signIn(page, owner);
  await seedRoomOverviewState({ page, roomId, userId: owner.userId, viewMode: 'threaded' });
  await page.goto(roomPath(roomId));
  await expect(page.getByText(/banned Banned Person/)).toBeVisible({ timeout: 20_000 });

  // The members panel opens by default on a wide window.
  const showMembers = page.getByRole('button', { name: 'Show Members', exact: true });
  if (await showMembers.isVisible()) await showMembers.click();
  await page.getByRole('button', { name: 'Joined', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Banned', exact: true }).click();
  await page.locator(`button[data-user-id="${member.userId}"]`).click();
  const card = page.locator('[data-user-moderation]');
  await expect(card.getByText('Banned User', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Unban', exact: true }).click();

  // The card follows the unban: no kick note, and the person's name stays.
  await expect(card.getByText('Banned User', { exact: true })).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText('Kicked User', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Banned Person', exact: true })
  ).toBeVisible();

  // The timeline names the person in the unban row as in the rows before it.
  const unbanned = page.getByText(/unbanned/);
  await expect(unbanned).toBeVisible({ timeout: 15_000 });
  await expect(unbanned).toContainText('Banned Person');
  await expect(unbanned).not.toContainText(member.username);
  await shot(page, 'unbanned-profile-and-row', browserName);
});

test('a space opened by link is titled by its name before joining @webkit', async ({ page }) => {
  test.setTimeout(90_000);
  const owner = await register('identity_space_owner', 'Space Keeper');
  const visitor = await register('identity_space_visitor', 'Space Visitor');
  const spaceName = `Linked space ${Date.now().toString(36)}`;
  const spaceId = await createRoom(getHomeserver(), owner.accessToken, {
    name: spaceName,
    preset: 'public_chat',
    space: true,
  });

  await signIn(page, visitor);
  await page.goto(`/${encodeURIComponent(spaceId)}/lobby/`);
  await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('heading', { level: 1, name: spaceName, exact: true })).toBeVisible();
  await expect(page.getByText(spaceId)).toHaveCount(0);
});
