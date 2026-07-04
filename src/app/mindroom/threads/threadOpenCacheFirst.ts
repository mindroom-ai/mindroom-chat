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
    void scheduleReconcile({
      roomId: room.roomId,
      room,
      threadId,
      cachedPage: hydratedCachedPage,
      reason: 'open-complete-coverage',
      onRepaired: () => {
        if (!isCurrentThreadOpen()) return;
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
