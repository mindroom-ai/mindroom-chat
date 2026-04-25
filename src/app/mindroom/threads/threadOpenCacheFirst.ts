import { Direction, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { Dispatch, SetStateAction } from 'react';
import { getLinkedTimelines } from '../../features/room/timelinePagination';
import { logTimelineDebug } from '../../features/room/timelineDebug';
import { mapCachedThreadPageEvents } from './eventRepository';
import {
  hasUsableThreadCacheSnapshot,
  isCompleteThreadCacheCoverage,
  shouldBackfillThreadRelationsFromCoverage,
} from './threadCacheCoverage';
import type {
  HydratedThreadCachePage,
  ThreadOpenCacheController,
} from './threadOpenCacheController';

type ThreadOpenSeedSession = {
  applyInitialUntargetedThreadSeed: () => void;
  mergeWithInitialRoomThreadSeedEvents: (events: MatrixEvent[]) => MatrixEvent[];
};

type RunThreadOpenCacheFirstOptions = {
  backfillThreadRelationsIntoCache: ThreadOpenCacheController['backfillThreadRelationsIntoCache'];
  debugTraceId: string | undefined;
  forceTimelineUpdate: () => void;
  hydrateThreadFromCache: ThreadOpenCacheController['hydrateThreadFromCache'];
  isCurrentThreadOpen: () => boolean;
  mx: MatrixClient;
  pinThreadToBottomOnOpen: () => void;
  refreshLatestThreadRelationsTail: ThreadOpenCacheController['refreshLatestThreadRelationsTail'];
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
  refreshLatestThreadRelationsTail,
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
    void refreshLatestThreadRelationsTail(threadId, hydratedCachedPage).catch(() => undefined);
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
      mapEvent: (rawEvent) => mapper(rawEvent),
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
