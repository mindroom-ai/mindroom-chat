/**
 * CINNY-207 AC2 revision (2026-07-04): rewrite of the STEP c/d repro.
 *
 * Pre-revision framing: STEP b's docker run pinned that after a
 * relations-backfill completed with `completed: true`,
 * `runThreadOpenCacheFirst` returned `shouldContinue: false` without
 * scheduling a reconcile — the AC2 return-nav open skipped both
 * schedule call sites (cache-first at the complete-coverage exit AND
 * lifecycle at the partial-coverage exit) because the backfill-completed
 * branch was BETWEEN them, and neither fired. STEP d "fixed" this by
 * adding a THIRD branch-local schedule call at the backfill-completed
 * exit.
 *
 * The revision rejects the STEP d shape as a defensive bandage
 * (per-branch schedules that can each independently be missed by a
 * future path added between them) and instead relocates the reconcile
 * schedule to a SINGLE choke point at the top of
 * `runThreadOpenCacheFirst`, right after the two hydrate guards. The
 * choke-point sits ABOVE every coverage/bootstrap branch, so it is
 * structurally impossible for the backfill-completed branch (or any
 * other coverage branch) to bail without a reconcile having been
 * scheduled.
 *
 * This test file now asserts the STRONGER invariant:
 *   - The choke-point schedule fires BEFORE the coverage branching
 *     runs, not after — so the reconcile is scheduled even if the
 *     backfill branch subsequently paints and returns.
 *   - The backfill-completed branch itself only PAINTS and returns;
 *     it does NOT carry its own schedule call site anymore.
 *   - The reason string is the single consolidated
 *     `'open-thread-choke-point'` (the three earlier open-* variants
 *     — open-complete-coverage, open-partial-coverage,
 *     open-backfill-completed — were consolidated when the branch
 *     schedule sites were deleted).
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
  // The order in which scheduleReconcile and backfillThreadRelationsIntoCache
  // are called is load-bearing: the choke-point revision REQUIRES the
  // reconcile to schedule BEFORE any coverage branching runs. Track call
  // order across the two mocks so we can prove the sequencing in a
  // dedicated assertion.
  const callOrder: string[] = [];
  return {
    backfillThreadRelationsIntoCache: vi.fn(async () => {
      callOrder.push('backfill');
      return { completed: true, fetchedCount: 25 };
    }),
    debugTraceId: 'test',
    forceTimelineUpdate: vi.fn(),
    hydrateThreadFromCache: vi.fn(),
    isCurrentThreadOpen: vi.fn(() => true),
    mx,
    pinThreadToBottomOnOpen: vi.fn(),
    scheduleReconcile: vi.fn(async () => {
      callOrder.push('scheduleReconcile');
      return {
        reason: 'open-thread-choke-point' as const,
        repaired: false,
        fetchedCount: 0,
        iterations: 1,
        aborted: false,
      };
    }),
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
    callOrder,
  };
};

describe('AC2 revision: choke-point reconcile fires before backfill-completed branch paints', () => {
  it('schedules the reconcile BEFORE the coverage branching runs, not after', async () => {
    // This is the load-bearing sequencing assertion. Pre-revision, the
    // backfill-completed branch carried its own scheduleReconcile call
    // AFTER the backfill returned — so scheduleReconcile always came
    // after `backfill` in the call log. Post-revision the choke-point
    // fires immediately after the post-hydrate guard, BEFORE the
    // coverage branching, so the order must be [scheduleReconcile,
    // backfill]. A regression that reinstates a per-branch schedule
    // would flip this order.
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

    // Backfill fired and reported completed, so shouldContinue=false
    // (SDK bootstrap is skipped because the cache now has the full
    // snapshot). This is the pre-existing paint behavior — the branch
    // is still the same shape, only the schedule call was relocated.
    expect(opts.backfillThreadRelationsIntoCache).toHaveBeenCalledTimes(1);
    expect(result.shouldContinue).toBe(false);

    // Choke-point invariant: reconcile scheduled EXACTLY ONCE, and
    // BEFORE any coverage branching. `scheduleReconcile` must appear
    // in the call log at index 0, before `backfill`.
    expect(opts.scheduleReconcile).toHaveBeenCalledTimes(1);
    expect(opts.callOrder[0]).toBe('scheduleReconcile');
    expect(opts.callOrder[1]).toBe('backfill');

    // Reason is the single consolidated choke-point value.
    const [reconcileArgs] = opts.scheduleReconcile.mock.calls[0] ?? [undefined];
    expect(reconcileArgs).toBeDefined();
    expect(reconcileArgs.roomId).toBe(opts.room.roomId);
    expect(reconcileArgs.threadId).toBe('$root');
    expect(reconcileArgs.reason).toBe('open-thread-choke-point');

    // Probe accounting: the choke-point scheduled counter bumped
    // exactly once for this open. The pre-revision counter set had
    // `threadOpenSkipCacheFirstBackfillCompleted` for the miss shape
    // and `threadOpenScheduledLifecycle` for the redundant partial-
    // coverage schedule — both are gone (see cacheProbe.ts revision
    // comment for the full pruning rationale).
    const snap = getCacheProbeSnapshot();
    expect(snap.threadOpenScheduledCacheFirst).toBe(1);
  });

  it('onRepaired callback routes fetched events through supplemental sink (render convergence leg)', async () => {
    // The choke-point call wires the reconciler's widened `onRepaired`
    // to `setSupplementalThreadEvents` because the complete-coverage
    // and backfill-completed branches both skip SDK bootstrap — so
    // the render's `fallbackThreadEventsState` is the only surface
    // that can converge in memory on those branches. This test pins
    // that wiring so a future refactor cannot silently drop it.
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
        reason: 'open-thread-choke-point' as const,
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
