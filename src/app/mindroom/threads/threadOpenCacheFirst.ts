import { Direction, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { Dispatch, SetStateAction } from 'react';
import { getLinkedTimelines } from './timelinePagination';
import { logTimelineDebug } from './timelineDebug';
import { createPreferLiveEventMapper, mapCachedThreadPageEvents } from './eventRepository';
import {
  hasUsableThreadCacheSnapshot,
  isCompleteThreadCacheCoverage,
  shouldBackfillThreadRelationsFromCoverage,
} from './threadCacheCoverage';
import type {
  HydratedThreadCachePage,
  ThreadOpenCacheController,
} from './threadOpenCacheController';
import type { ReconcileResult, ScheduleReconcileArgs } from '../engine/reconciler';

type ThreadOpenSeedSession = {
  applyInitialUntargetedThreadSeed: () => void;
  mergeWithInitialRoomThreadSeedEvents: (events: MatrixEvent[]) => MatrixEvent[];
};

/**
 * Injected scheduler entry point. Component-side callers pre-bind the
 * engine's mx / sessionId / scheduler so this file does not need to
 * reach into the engine directly (keeps arch-guard boundaries clean).
 */
export type ScheduleReconcileFn = (
  args: Pick<
    ScheduleReconcileArgs,
    'roomId' | 'room' | 'threadId' | 'cachedPage' | 'reason' | 'onRepaired' | 'shouldContinue'
  >
) => Promise<ReconcileResult>;

type RunThreadOpenCacheFirstOptions = {
  backfillThreadRelationsIntoCache: ThreadOpenCacheController['backfillThreadRelationsIntoCache'];
  debugTraceId: string | undefined;
  forceTimelineUpdate: () => void;
  hydrateThreadFromCache: ThreadOpenCacheController['hydrateThreadFromCache'];
  isCurrentThreadOpen: () => boolean;
  mx: MatrixClient;
  pinThreadToBottomOnOpen: () => void;
  /**
   * CINNY-207 P5.1 (D7): replaces the deleted
   * `refreshLatestThreadRelationsTail`. The complete-coverage path
   * still schedules a reconcile so a stale cache converges after open
   * without reload — coverage decides PAINT, never REVALIDATE.
   */
  scheduleReconcile: ScheduleReconcileFn;
  room: Room;
  /**
   * CINNY-207 P5-GATE-FIX v3 (AC2 dual-injection, render leg): the
   * reconciler's widened `onRepaired` callback hands us the
   * fully-mapped batch of fetched events; we route them into the
   * render's supplemental-events sink so the complete-coverage
   * cache-first path (SDK bootstrap skipped by design) converges. The
   * sink itself lives in `useThreadRenderState.setSupplementalThreadEvents`
   * and dedups by event id, so re-passing an already-known live event
   * is a no-op there. Kept as a separate injected function so this
   * module does not import from `useThreadRenderState` and so the
   * engine boundary stays clean (engine has no knowledge of
   * `setSupplementalThreadEvents`).
   */
  setSupplementalThreadEvents: (expectedThreadId: string, events: MatrixEvent[]) => void;
  setThreadHasMoreCachedBack: Dispatch<SetStateAction<boolean>>;
  setThreadInitialCacheHydrated: Dispatch<SetStateAction<boolean>>;
  setThreadTailLoaded: Dispatch<SetStateAction<boolean>>;
  setThreadTimelineTick: Dispatch<SetStateAction<number>>;
  shouldScrollToLatestOnOpen: boolean;
  threadId: string;
  threadOpenSeedSession: ThreadOpenSeedSession;
};

type RunThreadOpenCacheFirstResult = {
  hydratedCachedPage?: HydratedThreadCachePage;
  shouldContinue: boolean;
};

export const runThreadOpenCacheFirst = async ({
  backfillThreadRelationsIntoCache,
  debugTraceId,
  forceTimelineUpdate,
  hydrateThreadFromCache,
  isCurrentThreadOpen,
  mx,
  pinThreadToBottomOnOpen,
  scheduleReconcile,
  room,
  setSupplementalThreadEvents,
  setThreadHasMoreCachedBack,
  setThreadInitialCacheHydrated,
  setThreadTailLoaded,
  setThreadTimelineTick,
  shouldScrollToLatestOnOpen,
  threadId,
  threadOpenSeedSession,
}: RunThreadOpenCacheFirstOptions): Promise<RunThreadOpenCacheFirstResult> => {
  let hydratedCachedPage;
  try {
    hydratedCachedPage = await hydrateThreadFromCache(threadId);
  } catch {
    if (!isCurrentThreadOpen()) return { shouldContinue: false };
    hydratedCachedPage = undefined;
  }
  if (!isCurrentThreadOpen()) return { shouldContinue: false };

  const cachedThreadHasLocalSnapshot =
    !!hydratedCachedPage &&
    hasUsableThreadCacheSnapshot({
      eventCount: hydratedCachedPage.events.length,
      rootPresent: !!hydratedCachedPage.rootEvent,
    });

  if (shouldScrollToLatestOnOpen && !cachedThreadHasLocalSnapshot) {
    threadOpenSeedSession.applyInitialUntargetedThreadSeed();
  }
  setThreadInitialCacheHydrated(true);

  const hasCompleteCachedThreadSnapshot =
    shouldScrollToLatestOnOpen &&
    !!hydratedCachedPage &&
    isCompleteThreadCacheCoverage({
      coverage: hydratedCachedPage.cacheCoverage,
      hasLocalSnapshot: cachedThreadHasLocalSnapshot,
    });

  if (hasCompleteCachedThreadSnapshot && hydratedCachedPage) {
    const firstThreadLiveTimeline = room
      .getThread(threadId)
      ?.getUnfilteredTimelineSet()
      .getLiveTimeline();
    const firstThreadTimeline = firstThreadLiveTimeline
      ? getLinkedTimelines(firstThreadLiveTimeline)[0]
      : undefined;
    firstThreadTimeline?.setPaginationToken(null, Direction.Backward);
    setThreadHasMoreCachedBack(false);
    setThreadTailLoaded(true);
    forceTimelineUpdate();
    setThreadTimelineTick((val) => val + 1);
    logTimelineDebug(debugTraceId, 'thread-open-complete-cache-hit', {
      cachedCount: hydratedCachedPage.events.length,
      threadId,
    });
    logTimelineDebug(debugTraceId, 'thread-open-complete', {
      shouldScrollToLatestOnOpen,
      skipNetworkBootstrap: true,
      threadId,
    });
    // CINNY-207 P5.1 (D7 / AC9): complete-coverage still schedules a
    // reconcile. Fire-and-forget from the caller's POV — the reconcile
    // is deduped in the scheduler and only calls `onRepaired` (which
    // batches a tick) if it actually applied a repair. When the cache
    // was right this is a cheap no-op: fetch, diff empty, no writes,
    // no tick.
    //
    // P5-GATE-FIX v3 (AC2 dual-injection, render leg): the widened
    // `onRepaired` receives the fully-mapped batch the reconciler
    // fetched. We route it through `setSupplementalThreadEvents`
    // (defence-in-depth against zero-length batches — the engine
    // guards this at its side too by only calling `onRepaired` when
    // repair actually ran, but the component-side wiring must also
    // skip cleanly to preserve the "one tick per repair" invariant).
    // Why this is required: on complete-coverage the SDK bootstrap
    // is skipped by design; `useThreadRenderState.buildThreadEvents`
    // reads `fallbackThreadEventsState.events` alongside
    // `thread.events`, and `setSupplementalThreadEvents` is the
    // component-owned sink for that fallback state.
    void scheduleReconcile({
      roomId: room.roomId,
      room,
      threadId,
      cachedPage: hydratedCachedPage,
      reason: 'open-complete-coverage',
      onRepaired: (repairedEvents) => {
        if (!isCurrentThreadOpen()) return;
        if (repairedEvents.length > 0) {
          setSupplementalThreadEvents(threadId, [...repairedEvents]);
        }
        forceTimelineUpdate();
        setThreadTimelineTick((val) => val + 1);
      },
      shouldContinue: isCurrentThreadOpen,
    }).catch(() => undefined);
    pinThreadToBottomOnOpen();
    return {
      hydratedCachedPage,
      shouldContinue: false,
    };
  }

  const canBackfillThreadRelations =
    shouldScrollToLatestOnOpen &&
    !!hydratedCachedPage &&
    shouldBackfillThreadRelationsFromCoverage({
      coverage: hydratedCachedPage.cacheCoverage,
      hasLocalSnapshot: cachedThreadHasLocalSnapshot,
    });
  if (canBackfillThreadRelations && hydratedCachedPage) {
    const mapper = mx.getEventMapper();
    const cachedSnapshotEvents = mapCachedThreadPageEvents({
      events: hydratedCachedPage.events,
      rootEvent: hydratedCachedPage.rootEvent,
      mapEvent: createPreferLiveEventMapper(room, mapper),
    });
    const baselineBackfillEvents =
      threadOpenSeedSession.mergeWithInitialRoomThreadSeedEvents(cachedSnapshotEvents);
    const relationBackfill = await backfillThreadRelationsIntoCache(
      threadId,
      hydratedCachedPage.rootEvent,
      baselineBackfillEvents,
      hydratedCachedPage.expectedReplyCount
    );
    if (!isCurrentThreadOpen()) return { shouldContinue: false };
    if (relationBackfill?.completed) {
      logTimelineDebug(debugTraceId, 'thread-open-complete', {
        completedBy: 'relations-backfill',
        shouldScrollToLatestOnOpen,
        skipNetworkBootstrap: true,
        threadId,
      });
      pinThreadToBottomOnOpen();
      return {
        hydratedCachedPage,
        shouldContinue: false,
      };
    }
  }

  return {
    hydratedCachedPage,
    shouldContinue: true,
  };
};
