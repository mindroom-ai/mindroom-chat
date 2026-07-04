import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { readRoomEventCacheEventIds } from '../helpers/storage';

const hasCredentials = !!process.env.E2E_USERNAME;

// CINNY-207 P3.2: red spec for AC13 (gap-fill after restart).
//
// P3.2 delivers only the MARK + ENQUEUE half of gap detection: on the
// engine's Sync→PREPARED after a reload, one `startup` gap-fill job is
// enqueued per joined room; the `gapFillsEnqueued` probe counter proves
// enqueue happened. The actual fill executor lands in Phase 4. This
// spec exercises the end-to-end user-observable outcome — a message
// sent while the client is closed reaches the room's cache after
// login — which stays red until Phase 4's fill executor lands.
//
// Flips green in Phase 4 (BackfillScheduler drains the queue and
// bridges the observable gap). Keep test.fail() active until then;
// remove when P4.1 turns AC13 green in the scorecard.
test.describe('CINNY-207 gap-fill after restart', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('a message sent while the client was closed reaches the room cache after login (AC13)', async ({
    page,
  }) => {
    // Expected red through P3.2. Flips green in P4.1 when the executor
    // drains the queue during catchup.
    test.fail();

    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const { accessToken, userId } = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomId = await createPrivateRoom(homeserver, accessToken, {
      name: `CINNY-207 Gap-Fill Room ${stamp}`,
      topic: 'Gap-fill after restart fixture.',
    });
    const seedBody = `Seed before close ${stamp}`;
    await sendRoomMessage(
      homeserver,
      accessToken,
      roomId,
      { msgtype: 'm.text', body: seedBody },
      'cinny-207'
    );

    // First login: bring the client up, mount the room, then close it.
    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId,
      userId,
      viewMode: 'threaded',
      filterState: createDefaultThreadFilterState(),
    });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    await expect(page.getByText(seedBody)).toBeVisible({ timeout: 30_000 });

    // Simulate "client closed": a fresh page context on the next call.
    // Between now and the restart the server accepts a message the
    // client will only ever learn about through a limited sync
    // (nothing else prompts a targeted /messages fetch).
    const offlineBody = `Sent while offline ${stamp}`;
    const offlineEventId = await sendRoomMessage(
      homeserver,
      accessToken,
      roomId,
      { msgtype: 'm.text', body: offlineBody },
      'cinny-207'
    );

    // Restart: reload the page (fresh mx client + cold cache hydration).
    await page.reload();
    await expectLoggedInShellStable(page);

    // Wait long enough for /sync to complete plus the gap-fill executor
    // (Phase 4) to run its /messages catchup.
    await page.waitForTimeout(12_000);

    const cachedEventIds = await readRoomEventCacheEventIds(page, roomId);
    console.log(
      `[cinny-207] gap-fill cached events: ${cachedEventIds.length} (looking for ${offlineEventId})`
    );
    expect(cachedEventIds).toContain(offlineEventId);
  });
});
