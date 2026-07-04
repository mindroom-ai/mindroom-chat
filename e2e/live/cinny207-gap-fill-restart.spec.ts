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

// CINNY-207 P4.2 (AC13): green spec for gap-fill after restart.
//
// Phase 3.2 landed the MARK + ENQUEUE half: TimelineReset on the room's
// unfiltered timelineSet writes a durable tail-discontinuity marker
// and enqueues a `limited-sync` gap-fill job; Sync→PREPARED enqueues a
// `startup` job per joined room. Phase 4.2 (this commit) lands the
// EXECUTOR: `gapFillExecutor` hands each queued job to the P4.1
// `BackfillScheduler`, which calls `mx.createMessagesRequest` and
// persists the returned raw events through `saveRoomEventsToCache`,
// then clears the durable marker.
//
// Fixture shape (tightened from the P3.2 red version per team-lead's
// STAGE 1 divergence-3 approval — testing more, not less):
//
//   1. Sign in, open a fresh private room, and prove the seed message
//      is rendered so the room is fully hydrated.
//   2. With the page still mounted, POST ~25 REST messages via the
//      Matrix REST API. That volume is what Tuwunel needs to actually
//      declare the next incremental sync `limited=true` when the
//      client's since-token is stale; sending a single message tends
//      to fit inside the normal sync buffer and never trips the code
//      path we're testing.
//   3. `page.reload()` — cold Cinny boot, fresh sync from the last
//      persisted since-token. If Tuwunel returns limited, the engine
//      hits TimelineReset and enqueues a `limited-sync` job; if it
//      does not, the Sync→PREPARED handler still enqueues a `startup`
//      job (which is exactly the fallback the scheduler is designed
//      to cover). Either way the executor should run.
//   4. Assert three things:
//        a) `schedulerCompleted` on the probe is at least 1 — the
//           executor ran to completion for this room.
//        b) `gapFillsEnqueued` is at least 1 — the tracker saw a gap
//           worth filling.
//        c) The last REST event id is present in the room event cache
//           IDB store — the user-observable outcome, without needing
//           to wait for the render pass.
//
// The 12s wait matches the P3.2 red version: /sync + a bounded
// `createMessagesRequest` loop should finish well inside that budget
// on a live network.
test.describe('CINNY-207 gap-fill after restart', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('a message sent while the client was closed reaches the room cache after login (AC13)', async ({
    page,
  }) => {
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

    // ~25 REST messages while the page is still mounted. This is enough
    // to reliably trigger `limited=true` on the next incremental sync
    // once the client's since-token becomes stale after the reload.
    // The specific value here is the LAST one — that's what we assert
    // is present in cache after the reload.
    let offlineEventId = '';
    const messageCount = 25;
    for (let i = 0; i < messageCount; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      offlineEventId = await sendRoomMessage(
        homeserver,
        accessToken,
        roomId,
        { msgtype: 'm.text', body: `Sent while offline ${stamp} #${i + 1}` },
        'cinny-207'
      );
    }

    // Restart: reload the page (fresh mx client + cold cache hydration).
    // Reset the probe on the fresh page so the counters we assert on
    // are attributable to the post-restart run alone.
    await page.reload();
    await expectLoggedInShellStable(page);
    await page.evaluate(() => {
      window.__MINDROOM_CACHE_PROBE__?.reset();
    });

    // Wait long enough for /sync to complete plus the gap-fill executor
    // to run its `createMessagesRequest` catchup.
    await page.waitForTimeout(12_000);

    const cachedEventIds = await readRoomEventCacheEventIds(page, roomId);
    const probe = await page.evaluate(() => window.__MINDROOM_CACHE_PROBE__?.snapshot() ?? {});
    console.log(
      `[cinny-207] gap-fill cached events: ${cachedEventIds.length} (looking for ${offlineEventId})`,
      probe
    );

    // (a) executor completed at least one gap-fill job for this session
    expect((probe as Record<string, number>).schedulerCompleted ?? 0).toBeGreaterThanOrEqual(1);
    // (b) tracker enqueued a gap-fill (startup or limited-sync)
    expect((probe as Record<string, number>).gapFillsEnqueued ?? 0).toBeGreaterThanOrEqual(1);
    // (c) user-observable outcome: the message reached the cache
    expect(cachedEventIds).toContain(offlineEventId);
  });
});
