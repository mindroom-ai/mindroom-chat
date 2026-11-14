import { expect, test } from '@playwright/test';
import { getHomeserver } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { matrixFetch } from '../helpers/matrix';

// After a room upgrade the room list shows the successor only: the old room, whose tombstone
// names a room the account has joined, no longer sits beside it under the same name.
const PASSWORD = 'room-upgrade-list-password';

test.use({ viewport: { width: 1280, height: 800 } });

test('an upgraded room is listed once, as its successor @webkit', async ({ page, browserName }) => {
  test.setTimeout(90_000);
  const homeserver = getHomeserver();
  const username = `upgrade_owner_${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const account = await matrixFetch<{ user_id: string; access_token: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  const roomName = `Upgraded room ${Date.now().toString(36)}`;
  const oldRoomId = await createRoom(homeserver, account.access_token, { name: roomName });

  await loginWithPassword(page, { homeserver, username, password: PASSWORD });
  const rows = page.getByRole('link', { name: new RegExp(roomName) });
  await expect(rows).toHaveCount(1, { timeout: 20_000 });

  const { replacement_room: newRoomId } = await matrixFetch<{ replacement_room: string }>(
    homeserver,
    `/rooms/${encodeURIComponent(oldRoomId)}/upgrade`,
    {
      method: 'POST',
      accessToken: account.access_token,
      body: JSON.stringify({ new_version: '11' }),
    }
  );
  expect(newRoomId).not.toBe(oldRoomId);

  // The successor arrives by sync; the old room leaves the list as it does.
  await expect(rows).toHaveCount(1, { timeout: 20_000 });
  await expect(rows).toHaveAttribute('href', new RegExp(encodeURIComponent(newRoomId)));
  // Once the successor shows, the list stays at one row.
  await page.waitForTimeout(2_000);
  await expect(rows).toHaveCount(1);
  // OFFLINE_IDENTITY_SHOTS=<directory> also saves the list.
  const shots = process.env.OFFLINE_IDENTITY_SHOTS;
  if (shots) await page.screenshot({ path: `${shots}/upgraded-room-list-${browserName}.png` });
});
