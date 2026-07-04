import { Direction, type MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  makeEvent,
  makeRoom,
  makeTimeline,
} from './test-utils/RoomTimeline.test.shared';
import { buildThreadCacheCoverage } from './threadCacheCoverage';
import { runThreadOpenCacheFirst } from './threadOpenCacheFirst';

const makeDefaultOptions = () => {
  const root = makeEvent('$root', { isThreadRoot: true, ts: 1 });
  const reply = makeEvent('$reply', { threadRootId: '$root', ts: 2 });
  const threadTimeline = makeTimeline([], { backwardToken: 'stale', forwardToken: null });
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
    mergeWithInitialRoomThreadSeedEvents: vi.fn((events: ReturnType<typeof makeEvent>[]) => events),
  };

  return {
    backfillThreadRelationsIntoCache: vi.fn(),
    debugTraceId: 'test',
    forceTimelineUpdate: vi.fn(),
    hydrateThreadFromCache: vi.fn(),
    isCurrentThreadOpen: vi.fn(() => true),
    mx,
    pinThreadToBottomOnOpen: vi.fn(),
    // CINNY-207 P5.1 (AC9): D7 rewire — `refreshLatestThreadRelationsTail`
    // was deleted; the complete-coverage path now schedules a reconcile
    // through the engine.
    scheduleReconcile: vi.fn(async () => ({
      reason: 'open-complete-coverage' as const,
      repaired: false,
      fetchedCount: 0,
      iterations: 1,
      aborted: false,
    })),
    room,
    // CINNY-207 P5-GATE-FIX v3 (AC2 dual-injection): component-side
    // supplemental-events sink. The reconciler's widened `onRepaired`
    // callback flows repaired events here so the render's fallback
    // event state converges even on the complete-coverage path where
    // SDK bootstrap is skipped by design.
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

describe('runThreadOpenCacheFirst', () => {
  it('short-circuits network bootstrap when cached thread coverage is complete', async () => {
    const opts = makeDefaultOptions();
    const cachedPage = {
      cacheCoverage: buildThreadCacheCoverage({
        eventCount: 2,
        backwardToken: null,
        hasMoreBackward: false,
        relationSnapshotComplete: true,
        snapshotComplete: true,
        tailLoaded: true,
      }),
      events: [{ event_id: '$reply', origin_server_ts: 2 }],
      hasMoreBefore: false,
      relationSnapshotComplete: true,
      rootEvent: { event_id: '$root', origin_server_ts: 1 },
      snapshotComplete: true,
      tailLoaded: true,
    };
    opts.hydrateThreadFromCache.mockResolvedValue(cachedPage);

    const result = await runThreadOpenCacheFirst(opts as never);

    expect(result).toEqual({ hydratedCachedPage: cachedPage, shouldContinue: false });
    expect(opts.threadOpenSeedSession.applyInitialUntargetedThreadSeed).not.toHaveBeenCalled();
    expect(opts.setThreadInitialCacheHydrated).toHaveBeenCalledWith(true);
    expect(opts.threadTimeline.setPaginationToken).toHaveBeenCalledWith(null, Direction.Backward);
    expect(opts.setThreadHasMoreCachedBack).toHaveBeenCalledWith(false);
    expect(opts.setThreadTailLoaded).toHaveBeenCalledWith(true);
    expect(opts.forceTimelineUpdate).toHaveBeenCalledTimes(1);
    // CINNY-207 P5.1 (D7 / AC9): coverage gates PAINT, never
    // REVALIDATE. Even on a complete-coverage cache hit the reconciler
    // is scheduled — when the cache was right, the reconcile is a
    // cheap no-op (fetch, diff empty, no writes, no tick).
    expect(opts.scheduleReconcile).toHaveBeenCalledTimes(1);
    expect(opts.scheduleReconcile).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: opts.room.roomId,
        threadId: '$root',
        cachedPage,
        reason: 'open-complete-coverage',
      })
    );
    expect(opts.pinThreadToBottomOnOpen).toHaveBeenCalledTimes(1);
    expect(opts.backfillThreadRelationsIntoCache).not.toHaveBeenCalled();
  });

  it('backfills incomplete cached thread relations before falling through to SDK bootstrap', async () => {
    const opts = makeDefaultOptions();
    const cachedPage = {
      cacheCoverage: buildThreadCacheCoverage({
        eventCount: 2,
        backwardToken: 'next',
        hasMoreBackward: true,
        relationSnapshotComplete: false,
        snapshotComplete: false,
        tailLoaded: true,
      }),
      events: [{ event_id: '$reply', origin_server_ts: 2 }],
      expectedReplyCount: 1,
      hasMoreBefore: true,
      relationSnapshotComplete: false,
      rootEvent: { event_id: '$root', origin_server_ts: 1 },
      snapshotComplete: false,
      tailLoaded: true,
    };
    opts.hydrateThreadFromCache.mockResolvedValue(cachedPage);
    opts.backfillThreadRelationsIntoCache.mockResolvedValue({ completed: true, fetchedCount: 0 });

    const result = await runThreadOpenCacheFirst(opts as never);

    expect(result).toEqual({ hydratedCachedPage: cachedPage, shouldContinue: false });
    expect(opts.threadOpenSeedSession.mergeWithInitialRoomThreadSeedEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          getId: expect.any(Function),
        }),
      ])
    );
    expect(opts.backfillThreadRelationsIntoCache).toHaveBeenCalledWith(
      '$root',
      cachedPage.rootEvent,
      expect.arrayContaining([
        expect.objectContaining({
          getId: expect.any(Function),
        }),
      ]),
      1
    );
    expect(opts.pinThreadToBottomOnOpen).toHaveBeenCalledTimes(1);
    // CINNY-207 P5.1: partial-coverage and no-cache paths let the
    // lifecycle controller schedule the reconcile after
    // `runThreadOpenSdkBootstrap`; the cache-first function itself
    // only schedules on the complete-coverage exit.
    expect(opts.scheduleReconcile).not.toHaveBeenCalled();
  });

  it('routes the reconciler onRepaired batch through setSupplementalThreadEvents + tick (CINNY-207 P5-GATE-FIX v3 AC2 dual-injection)', async () => {
    // Team-lead directive: the engine widens `onRepaired` to carry the
    // repaired MatrixEvent batch; component-side callback wires it into
    // `setSupplementalThreadEvents(threadId, repairedEvents)` + a tick.
    // That closes the "SDK model still empty, render leans on
    // fallback events" gap on the complete-coverage cache-first path
    // (SDK bootstrap is skipped by design when the cache is complete —
    // see `useThreadRenderState.buildThreadEvents`).
    //
    // Under the pre-v3 wiring the callback was `() => {}` shape and
    // only fired a tick — the render still held its stale supplemental
    // instances. Under v3 the callback receives the repaired batch and
    // merges it into the supplemental state, which
    // `useThreadRenderState.setSupplementalThreadEvents` also
    // hydrates via `hydrateCachedEvents` (P1.2 pipeline) — the edit
    // now lands on whichever instance ends up in the merged list.
    const opts = makeDefaultOptions();
    const cachedPage = {
      cacheCoverage: buildThreadCacheCoverage({
        eventCount: 2,
        backwardToken: null,
        hasMoreBackward: false,
        relationSnapshotComplete: true,
        snapshotComplete: true,
        tailLoaded: true,
      }),
      events: [{ event_id: '$reply', origin_server_ts: 2 }],
      hasMoreBefore: false,
      relationSnapshotComplete: true,
      rootEvent: { event_id: '$root', origin_server_ts: 1 },
      snapshotComplete: true,
      tailLoaded: true,
    };
    opts.hydrateThreadFromCache.mockResolvedValue(cachedPage);

    // Capture the onRepaired callback that the caller wires into
    // scheduleReconcile so we can simulate the reconciler's repair path
    // firing it with a repaired-events batch.
    let capturedOnRepaired:
      | ((repairedEvents: readonly MatrixEvent[]) => void)
      | undefined;
    opts.scheduleReconcile.mockImplementation(async (args: {
      onRepaired?: (repairedEvents: readonly MatrixEvent[]) => void;
    }) => {
      capturedOnRepaired = args.onRepaired;
      return {
        reason: 'open-complete-coverage' as const,
        repaired: true,
        fetchedCount: 1,
        iterations: 1,
        aborted: false,
      };
    });

    await runThreadOpenCacheFirst(opts as never);

    expect(opts.scheduleReconcile).toHaveBeenCalledTimes(1);
    expect(capturedOnRepaired).toBeDefined();

    // Baseline: setSupplementalThreadEvents has not been called yet
    // during the cache-first path itself — the hydration path lives in
    // hydrateThreadFromCache, which is mocked here. All the following
    // calls must therefore come from the onRepaired wiring.
    const supplementalMock = opts.setSupplementalThreadEvents as ReturnType<typeof vi.fn>;
    const preRepairCalls = supplementalMock.mock.calls.length;

    // Simulate the reconciler firing the tick with a repaired batch.
    const repairedEvent = makeEvent('$edit-v2', { threadRootId: '$root', ts: 3 });
    capturedOnRepaired?.([repairedEvent]);

    // The load-bearing assertion: the repaired batch flows into
    // setSupplementalThreadEvents. Under pre-v3 code this call count
    // stays at preRepairCalls (the callback only re-ran the tick).
    expect(supplementalMock.mock.calls.length).toBe(preRepairCalls + 1);
    expect(supplementalMock).toHaveBeenLastCalledWith('$root', [repairedEvent]);

    // Tick still fires so the render re-reads the now-merged
    // supplemental state (setSupplementalThreadEvents itself updates
    // state, but the additional tick preserves parity with the pre-v3
    // callback and keeps the "one tick per repair" invariant).
    expect(opts.setThreadTimelineTick).toHaveBeenCalled();
  });

  it('does not call setSupplementalThreadEvents for an empty repaired batch (CINNY-207 P5-GATE-FIX v3 cost guarantee)', async () => {
    // Defense-in-depth: the reconciler only fires onRepaired when it
    // actually applied a repair, but even a paranoid "call with empty
    // array" should be a no-op on the component side — the merge
    // machinery in `setSupplementalThreadEvents` allocates a new
    // fallback state on every call, and a zero-event batch would
    // still churn the render.
    const opts = makeDefaultOptions();
    const cachedPage = {
      cacheCoverage: buildThreadCacheCoverage({
        eventCount: 2,
        backwardToken: null,
        hasMoreBackward: false,
        relationSnapshotComplete: true,
        snapshotComplete: true,
        tailLoaded: true,
      }),
      events: [{ event_id: '$reply', origin_server_ts: 2 }],
      hasMoreBefore: false,
      relationSnapshotComplete: true,
      rootEvent: { event_id: '$root', origin_server_ts: 1 },
      snapshotComplete: true,
      tailLoaded: true,
    };
    opts.hydrateThreadFromCache.mockResolvedValue(cachedPage);

    let capturedOnRepaired:
      | ((repairedEvents: readonly MatrixEvent[]) => void)
      | undefined;
    opts.scheduleReconcile.mockImplementation(async (args: {
      onRepaired?: (repairedEvents: readonly MatrixEvent[]) => void;
    }) => {
      capturedOnRepaired = args.onRepaired;
      return {
        reason: 'open-complete-coverage' as const,
        repaired: false,
        fetchedCount: 0,
        iterations: 1,
        aborted: false,
      };
    });

    await runThreadOpenCacheFirst(opts as never);

    const supplementalMock = opts.setSupplementalThreadEvents as ReturnType<typeof vi.fn>;
    const preCalls = supplementalMock.mock.calls.length;

    // Fire with an empty batch (contract-defensive test — the engine
    // guards against this itself by not calling onRepaired at all
    // when there is nothing to repair, but the component-side wiring
    // must also skip cleanly if the callback is ever invoked empty).
    capturedOnRepaired?.([]);

    expect(supplementalMock.mock.calls.length).toBe(preCalls);
  });

  it('applies the initial seed and continues when no usable cache exists', async () => {
    const opts = makeDefaultOptions();
    opts.hydrateThreadFromCache.mockResolvedValue(undefined);

    const result = await runThreadOpenCacheFirst(opts as never);

    expect(result).toEqual({ hydratedCachedPage: undefined, shouldContinue: true });
    expect(opts.threadOpenSeedSession.applyInitialUntargetedThreadSeed).toHaveBeenCalledTimes(1);
    expect(opts.setThreadInitialCacheHydrated).toHaveBeenCalledWith(true);
    expect(opts.backfillThreadRelationsIntoCache).not.toHaveBeenCalled();
    // CINNY-207 P5.1: partial-coverage and no-cache paths let the
    // lifecycle controller schedule the reconcile after
    // `runThreadOpenSdkBootstrap`; the cache-first function itself
    // only schedules on the complete-coverage exit.
    expect(opts.scheduleReconcile).not.toHaveBeenCalled();
  });
});
