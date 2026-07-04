/**
 * CINNY-207 AC2 STEP 4 iter 2 STEP c (2026-07-04): minimized RED repro
 * of the upstream skip pinned by STEP b's docker run.
 *
 * STEP b's probe snapshot (extracted from playwright trace,
 * `[cinny-207] ac2-probe t30s` line):
 *
 *   threadOpens = 2
 *   threadOpenSkipCacheFirstBackfillCompleted = 1  ← the return-nav open
 *   threadOpenSkipCacheFirstPostHydrateGuard   = 1  ← first-open cleanup
 *   threadOpenScheduledCacheFirst = 0
 *   threadOpenScheduledLifecycle  = 0
 *   reconcilesScheduled           = 1  (all from noteRoomFocused,
 *                                      the room-scope tripwire)
 *   reconcilesRoomScopeNoop       = 1
 *
 * Invariant `threadOpens == sum(scheduled + skip counters)` holds:
 *   2 == 0 + 0 + 1 + 1
 *
 * The pinned mechanism: after a relations-backfill completes with
 * `completed: true` (snapshot deemed complete), `runThreadOpenCacheFirst`
 * returns `shouldContinue: false` WITHOUT scheduling a reconcile — and
 * the lifecycle controller then respects that early-out, so the
 * partial-coverage `scheduleReconcile` at
 * threadOpenLifecycleController.ts:220 never fires either. Any
 * server-side divergence that landed AFTER the backfill window is
 * frozen in the cache until the next full reload.
 *
 * This violates D7: "coverage decides PAINT, never REVALIDATE" — a
 * complete-coverage paint should always still schedule a revalidate.
 *
 * Assertions below are RED against the pre-fix code because we assert
 * that `scheduleReconcile` IS called from the cache-first path when the
 * backfill completes. Once STEP d (the fix) lands, these turn green.
 * The test is committed as passing NOW (using `it.fails`) so a
 * regression that re-introduces the skip fails loudly rather than
 * silently.
 */
import { describe, expect, it, vi } from 'vitest';
import { makeEvent, makeRoom, makeTimeline } from '../test-utils/RoomTimeline.test.shared';
import { buildThreadCacheCoverage } from '../threadCacheCoverage';
import { runThreadOpenCacheFirst } from '../threadOpenCacheFirst';
import { getCacheProbeSnapshot, resetCacheProbe } from '../cacheProbe';

const makeBackfillCompletedOptions = () => {
  const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
  const reply = makeEvent('$reply', { threadRootId: '$root', ts: 2 });
  const threadTimeline = makeTimeline([], { backwardToken: null, forwardToken: null });
  const thread = {
    id: '$root',
    rootEvent: root,
    events: [reply],
    getUnfilteredTimelineSet: () => ({
      getLiveTimeline: () => threadTimeline,
    }),
  };
  const room = makeRoom({ liveEvents: [root], threads: [thread as never] });
  const mx = {
    getEventMapper: vi.fn(
      () => (rawEvent: { event_id?: string; origin_server_ts?: number }) => {
        if (rawEvent.event_id === '$root') return root;
        if (rawEvent.event_id === '$reply') return reply;
        return makeEvent(rawEvent.event_id ?? '$unknown');
      }
    ),
  };
  const threadOpenSeedSession = {
    applyInitialUntargetedThreadSeed: vi.fn(),
    mergeWithInitialRoomThreadSeedEvents: vi.fn(
      (events: ReturnType<typeof makeEvent>[]) => events
    ),
  };
  return {
    // Backfill returns `completed: true` — this is the exact shape that
    // triggers the skip on the AC2 return-nav open.
    backfillThreadRelationsIntoCache: vi.fn(async () => ({
      completed: true,
      fetchedCount: 25,
    })),
    debugTraceId: 'test',
    forceTimelineUpdate: vi.fn(),
    hydrateThreadFromCache: vi.fn(),
    isCurrentThreadOpen: vi.fn(() => true),
    mx,
    pinThreadToBottomOnOpen: vi.fn(),
    scheduleReconcile: vi.fn(async () => ({
      reason: 'open-complete-coverage' as const,
      repaired: false,
      fetchedCount: 0,
      iterations: 1,
      aborted: false,
    })),
    room,
    setSupplementalThreadEvents: vi.fn(),
    setThreadHasMoreCachedBack: vi.fn(),
    setThreadInitialCacheHydrated: vi.fn(),
    setThreadTailLoaded: vi.fn(),
    setThreadTimelineTick: vi.fn((updater: (value: number) => number) => updater(0)),
    shouldScrollToLatestOnOpen: true,
    threadId: '$root',
    threadOpenSeedSession,
    threadTimeline,
  };
};

describe('AC2 STEP 4 iter 2 STEP c/d: relations-backfill-completed reconcile schedule', () => {
  it('D7 invariant: a completed backfill schedules a reconcile with reason open-backfill-completed', async () => {
    // STEP d fix (2026-07-04): repurposes the pre-existing
    // paint-and-bail branch as paint-AND-schedule. Cache page shape
    // that lands on the partial-coverage branch and triggers
    // `shouldBackfillThreadRelationsFromCoverage` → the code calls
    // `backfillThreadRelationsIntoCache` (which returns
    // `completed: true`), then now BOTH fires `scheduleReconcile` and
    // early-returns with `shouldContinue: false` at
    // threadOpenCacheFirst.ts:214-249. Pre-fix: only the early-return
    // happened, the reconcile never scheduled.
    //
    // The critical inputs for this branch:
    //   - hasCompleteCachedThreadSnapshot = false (partial coverage)
    //   - shouldBackfillThreadRelationsFromCoverage = true
    // Achieved by:
    //   - a hydrated cached page with a non-empty local snapshot
    //   - coverage that is NOT complete (backwardToken present) but
    //     otherwise usable — so the partial-coverage backfill kicks in.
    resetCacheProbe();
    const opts = makeBackfillCompletedOptions();
    const cachedPage = {
      cacheCoverage: buildThreadCacheCoverage({
        eventCount: 2,
        backwardToken: 'partial-back-token',
        hasMoreBackward: true,
        relationSnapshotComplete: false,
        snapshotComplete: false,
        tailLoaded: true,
      }),
      events: [{ event_id: '$reply', origin_server_ts: 2 }],
      hasMoreBefore: true,
      relationSnapshotComplete: false,
      rootEvent: { event_id: '$root', origin_server_ts: 1 },
      snapshotComplete: false,
      tailLoaded: true,
    };
    opts.hydrateThreadFromCache.mockResolvedValue(cachedPage);

    const result = await runThreadOpenCacheFirst(opts as never);

    // Backfill fired and reported completed, so shouldContinue is
    // false (the SDK bootstrap is skipped because the cache now has
    // the full snapshot). This is the pre-existing paint behavior
    // preserved by the fix.
    expect(opts.backfillThreadRelationsIntoCache).toHaveBeenCalledTimes(1);
    expect(result.shouldContinue).toBe(false);

    // D7 invariant assertion: the reconcile was scheduled with a
    // reason string that names the backfill-completed origin — so a
    // trace-based diagnosis can distinguish this from the complete-
    // coverage and partial-coverage schedule call sites.
    expect(opts.scheduleReconcile).toHaveBeenCalledTimes(1);
    const [reconcileArgs] = opts.scheduleReconcile.mock.calls[0] ?? [undefined];
    expect(reconcileArgs).toBeDefined();
    expect(reconcileArgs.roomId).toBe(opts.room.roomId);
    expect(reconcileArgs.threadId).toBe('$root');
    expect(reconcileArgs.reason).toBe('open-backfill-completed');

    // Probe: the scheduled-cache-first counter bumped (the new
    // schedule call site), the skip counter did NOT bump.
    const snap = getCacheProbeSnapshot();
    expect(snap.threadOpenScheduledCacheFirst).toBe(1);
    expect(snap.threadOpenSkipCacheFirstBackfillCompleted).toBe(0);
    expect(snap.threadOpenScheduledLifecycle).toBe(0);
  });

  it('onRepaired callback routes fetched events through supplemental sink (render convergence leg)', async () => {
    // The complete-coverage branch (line ~167 in threadOpenCacheFirst.ts)
    // wires the reconciler's widened `onRepaired` to
    // `setSupplementalThreadEvents` for the same reason: SDK bootstrap
    // is skipped so the render's `fallbackThreadEventsState` is the
    // only surface that can converge in memory. The STEP d fix uses
    // the same wiring on the backfill-completed branch — this test
    // pins that behavior so a future refactor cannot silently drop it.
    resetCacheProbe();
    const opts = makeBackfillCompletedOptions();
    const cachedPage = {
      cacheCoverage: buildThreadCacheCoverage({
        eventCount: 2,
        backwardToken: 'partial-back-token',
        hasMoreBackward: true,
        relationSnapshotComplete: false,
        snapshotComplete: false,
        tailLoaded: true,
      }),
      events: [{ event_id: '$reply', origin_server_ts: 2 }],
      hasMoreBefore: true,
      relationSnapshotComplete: false,
      rootEvent: { event_id: '$root', origin_server_ts: 1 },
      snapshotComplete: false,
      tailLoaded: true,
    };
    opts.hydrateThreadFromCache.mockResolvedValue(cachedPage);

    // Wire scheduleReconcile to invoke onRepaired with a synthetic
    // repaired batch so we can observe the sink routing.
    const repaired = [makeEvent('$repaired-v2', { ts: 3 })];
    opts.scheduleReconcile.mockImplementation(async (args: never) => {
      const a = args as { onRepaired?: (evts: unknown[]) => void };
      a.onRepaired?.(repaired);
      return {
        reason: 'open-backfill-completed' as const,
        repaired: true,
        fetchedCount: 1,
        iterations: 1,
        aborted: false,
      };
    });

    await runThreadOpenCacheFirst(opts as never);

    expect(opts.setSupplementalThreadEvents).toHaveBeenCalledTimes(1);
    const [threadId, events] = opts.setSupplementalThreadEvents.mock.calls[0] ?? [];
    expect(threadId).toBe('$root');
    expect(events).toEqual(repaired);
  });
});
