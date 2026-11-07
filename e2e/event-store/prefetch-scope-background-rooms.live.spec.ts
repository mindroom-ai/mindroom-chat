import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { createPrivateRoom, sendRoomMessage } from '../helpers/matrix';
import { readRoomEventCacheEventIds } from '../helpers/storage';

// Settings, Storage & offline, Prefetch scope (ACCT-12, L5-F030). With "All rooms" the client
// fills the history gap a room got while the client was closed, without anyone opening the room;
// with "Current room only" (the default) it leaves that room alone until it is opened. The client
// syncs 20 events per room, so 40 messages sent while it is closed leave a gap before the newest 20.
test.describe.configure({ timeout: 240_000 });

/**
 * Signs a new account in with the scope, visits its room once, closes the client while 40
 * messages arrive, then opens Home with no room open. Returns the missed messages, oldest first,
 * and the room's history requests (`/messages`) since Home opened.
 */
const missMessagesInABackgroundRoom = async (page: Page, scope: string) => {
  const stamp = Date.now().toString(36);
  const user = await registerDisposableUser(`prefetch-${stamp}`, `pw-${stamp}`);
  const roomId = await createPrivateRoom(DISPOSABLE_HOMESERVER, user.accessToken, {
    name: 'Field notes',
    topic: 'Kept ready in the background',
  });
  const seed = `Field notes start ${stamp}`;
  await sendRoomMessage(DISPOSABLE_HOMESERVER, user.accessToken, roomId, {
    msgtype: 'm.text',
    body: seed,
  });

  await page.addInitScript((value) => {
    localStorage.setItem(
      'mindroomSettings',
      JSON.stringify({ v: 2, prefetchScope: value, prefetchDepth: 10_000 })
    );
  }, scope);
  await loginWithPassword(page, {
    homeserver: DISPOSABLE_HOMESERVER,
    username: user.username,
    password: user.password,
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expect(page.getByText(seed)).toBeVisible({ timeout: 60_000 });

  await page.goto('about:blank');
  const missed: string[] = [];
  for (let index = 1; index <= 40; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const eventId = await sendRoomMessage(
      DISPOSABLE_HOMESERVER,
      user.accessToken,
      roomId,
      { msgtype: 'm.text', body: `Field note ${index} of the trip, measured at station ${index}.` },
      `prefetch-${stamp}`
    );
    missed.push(eventId);
  }

  const historyRequests: string[] = [];
  page.on('request', (request) => {
    if (decodeURIComponent(request.url()).includes(`/rooms/${roomId}/messages`)) {
      historyRequests.push(request.url());
    }
  });
  await page.goto('/home/');
  await waitForLoggedInShell(page);
  return { roomId, missed, historyRequests };
};

test('with "All rooms", a room nobody opens gets the history it missed', async ({ page }) => {
  test.skip(!(await disposableHomeserverIsUp()), 'No disposable homeserver');
  const { roomId, missed, historyRequests } = await missMessagesInABackgroundRoom(
    page,
    'all-rooms'
  );
  // The sync brings the newest 20; only a history request brings the oldest.
  await expect
    .poll(() => readRoomEventCacheEventIds(page, roomId), {
      timeout: 60_000,
      message: 'the oldest missed message reaches the cache',
    })
    .toContain(missed[0]);
  expect(historyRequests.length).toBeGreaterThan(0);
});

test('with "Current room only", a room nobody opens keeps its gap', async ({ page }) => {
  test.skip(!(await disposableHomeserverIsUp()), 'No disposable homeserver');
  const { roomId, missed, historyRequests } = await missMessagesInABackgroundRoom(
    page,
    'current-room-only'
  );
  await expect
    .poll(() => readRoomEventCacheEventIds(page, roomId), {
      timeout: 60_000,
      message: 'the newest missed message arrives by sync',
    })
    .toContain(missed[missed.length - 1]);
  // Nothing may happen, so the check waits as long as "All rooms" takes to fill the gap.
  await page.waitForTimeout(15_000);
  expect(historyRequests).toEqual([]);
  expect(await readRoomEventCacheEventIds(page, roomId)).not.toContain(missed[0]);
});
