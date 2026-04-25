import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import {
  Direction,
  type EventTimelineSet,
  type IEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import to from 'await-to-js';
import { THREAD_BATCH_SIZE } from '../../state/settings';
import { logTimelineDebug } from './timelineDebug';
import { getLinkedTimelines } from './timelinePagination';
import {
  collectRedactedRelationTargetsFromLookup,
  reconcileRelationEventsWithAggregation,
} from '../../features/room/eventCacheEditUtils';
import { reconcileThreadBackwardPagination } from './threadPaginationUtils';
import { loadThreadCachedSnapshot, mapCachedThreadPageEvents } from './eventRepository';
import { fetchAllThreadRelations, MAX_THREAD_FETCH_ITERATIONS } from './threadBootstrap';
import {
  getAuthoritativeCachedThreadReplyCount,
  isCompleteCachedThreadSnapshot,
  mergeThreadBackfillEvents,
} from './threadCacheSnapshot';
import {
  buildThreadCacheCoverage,
  hasThreadCacheBackwardGap,
  hasThreadCacheKnownBackwardStart,
} from './threadCacheCoverage';
import { saveThreadOpenSeedSnapshot } from './threadOpenSeedCache';
import { getKnownThreadReplyCount } from './threadRecord';
import type { ThreadCacheCoverage } from './types';

export type HydratedThreadCachePage = {
  beforeToken?: string | null;
  cacheCoverage: ThreadCacheCoverage;
  events: Partial<IEvent>[];
  expectedReplyCount?: number;
  hasMoreBefore: boolean;
  relationSnapshotComplete: boolean;
  rootEvent?: Partial<IEvent>;
  snapshotComplete: boolean;
  tailLoaded: boolean;
};

type PersistThreadEventCache = (
  expectedThreadId: string,
  events: MatrixEvent[],
  rootEvent?: MatrixEvent | null,
  beforeTokenForEarliest?: string | null,
  tailLoaded?: boolean,
  snapshotComplete?: boolean,
  expectedReplyCount?: number,
  relationSnapshotComplete?: boolean
) => void;

export type ThreadOpenCacheController = {
  backfillThreadRelationsIntoCache: (
    expectedThreadId: string,
    cachedRootEvent?: Partial<IEvent>,
    baselineEvents?: MatrixEvent[],
    expectedReplyCount?: number
  ) => Promise<{ completed: boolean; fetchedCount: number } | undefined>;
  hydrateThreadFromCache: (expectedThreadId: string) => Promise<HydratedThreadCachePage | undefined>;
  refreshLatestThreadRelationsTail: (
    expectedThreadId: string,
    cachedPage: HydratedThreadCachePage
  ) => Promise<boolean>;
  refreshLatestThreadSlice: (
    expectedThreadId: string,
    opts?: {
      allowWhenThreadClosed?: boolean;
    }
  ) => Promise<boolean>;
};

export const useThreadOpenCacheController = ({
  alive,
  debugTraceId,
  forceTimelineUpdate,
  mx,
  persistThreadEventCache,
  room,
  roomIdRef,
  roomTimelineSet,
  safePaginationLimitRef,
  sessionId,
  setSupplementalThreadEvents,
  setThreadHasMoreCachedBack,
  setThreadTailLoaded,
  setThreadTimelineTick,
  threadIdRef,
}: {
  alive: () => boolean;
  debugTraceId: string | undefined;
  forceTimelineUpdate: () => void;
  mx: MatrixClient;
  persistThreadEventCache: PersistThreadEventCache;
  room: Room;
  roomIdRef: MutableRefObject<string>;
  roomTimelineSet: EventTimelineSet;
  safePaginationLimitRef: MutableRefObject<number>;
  sessionId: string;
  setSupplementalThreadEvents: (threadId: string, events: MatrixEvent[]) => void;
  setThreadHasMoreCachedBack: Dispatch<SetStateAction<boolean>>;
  setThreadTailLoaded: Dispatch<SetStateAction<boolean>>;
  setThreadTimelineTick: Dispatch<SetStateAction<number>>;
  threadIdRef: MutableRefObject<string | undefined>;
}): ThreadOpenCacheController => {
  const hydrateThreadFromCache = useCallback(
    async (expectedThreadId: string) => {
      logTimelineDebug(debugTraceId, 'thread-cache-hydrate-start', {
        limit: safePaginationLimitRef.current,
        threadId: expectedThreadId,
      });
      const mapper = mx.getEventMapper();
      const cachedSnapshot = await loadThreadCachedSnapshot({
        sessionId,
        roomId: room.roomId,
        threadId: expectedThreadId,
        limit: safePaginationLimitRef.current,
        maxPages: MAX_THREAD_FETCH_ITERATIONS,
        mapEvent: (rawEvent) => mapper(rawEvent),
        shouldContinue: () => alive() && threadIdRef.current === expectedThreadId,
        onPage: (page, pageIndex, snapshot) => {
          logTimelineDebug(debugTraceId, 'thread-cache-hydrate-page', {
            beforeToken: page.beforeToken ?? null,
            cachedCount: page.events.length,
            expectedReplyCount: snapshot.expectedReplyCount ?? null,
            hasMoreBefore: page.hasMoreBefore,
            pageIndex,
            relationSnapshotComplete: snapshot.relationSnapshotComplete === true,
            rootPresent: !!page.rootEvent,
            snapshotComplete: snapshot.snapshotComplete === true,
            tailLoaded: snapshot.tailLoaded === true,
            threadId: expectedThreadId,
          });
        },
      });
      if (!cachedSnapshot) return undefined;
      const cachedPage = cachedSnapshot.cachedPage;
      const cachedSnapshotComplete = cachedPage.snapshotComplete === true;
      const cachedRelationSnapshotComplete = cachedPage.relationSnapshotComplete === true;
      const tailLoaded = cachedPage.tailLoaded === true;

      if (!alive() || threadIdRef.current !== expectedThreadId) return undefined;

      const cachedEvents = cachedSnapshot.events;
      const liveRootMatrixEvent =
        room.getThread(expectedThreadId)?.rootEvent ??
        room.findEventById(expectedThreadId) ??
        undefined;
      const cachedRootMatrixEvent =
        cachedEvents.find((mEvent) => mEvent.getId() === expectedThreadId) ?? undefined;
      const authoritativeExpectedReplyCount = getAuthoritativeCachedThreadReplyCount({
        rootEvent: liveRootMatrixEvent,
        cachedRootEvent: cachedRootMatrixEvent,
        expectedReplyCount: cachedPage.expectedReplyCount,
      });
      const snapshotComplete = isCompleteCachedThreadSnapshot({
        room,
        threadId: expectedThreadId,
        rootEvent: liveRootMatrixEvent,
        cachedRootEvent: cachedRootMatrixEvent,
        cachedEvents,
        beforeToken: cachedPage.beforeToken,
        hasMoreBefore: cachedPage.hasMoreBefore,
        expectedReplyCount: authoritativeExpectedReplyCount,
        snapshotComplete: cachedSnapshotComplete,
        tailLoaded,
      });
      const cacheCoverage = buildThreadCacheCoverage({
        eventCount: cachedEvents.length + (cachedRootMatrixEvent ? 1 : 0),
        backwardToken: cachedPage.beforeToken,
        hasMoreBackward: cachedPage.hasMoreBefore || typeof cachedPage.beforeToken === 'string',
        expectedReplyCount: authoritativeExpectedReplyCount,
        relationSnapshotComplete: cachedRelationSnapshotComplete,
        snapshotComplete,
        tailLoaded,
      });
      const currentThreadTimelineSet = room.getThread(expectedThreadId)?.getUnfilteredTimelineSet();
      const currentFirstThreadTimeline = currentThreadTimelineSet
        ? getLinkedTimelines(currentThreadTimelineSet.getLiveTimeline())[0]
        : undefined;
      const cacheProvesNoBackwardGap =
        snapshotComplete === true && hasThreadCacheKnownBackwardStart(cacheCoverage);
      const hadStaleSdkBackwardToken =
        currentFirstThreadTimeline?.getPaginationToken(Direction.Backward) != null;
      if (cacheProvesNoBackwardGap && currentFirstThreadTimeline && hadStaleSdkBackwardToken) {
        currentFirstThreadTimeline.setPaginationToken(null, Direction.Backward);
        logTimelineDebug(debugTraceId, 'thread-cache-hydrate-clear-backward-gap', {
          threadId: expectedThreadId,
        });
      }
      setThreadHasMoreCachedBack(hasThreadCacheBackwardGap(cacheCoverage));
      if (cachedEvents.length === 0) {
        logTimelineDebug(debugTraceId, 'thread-cache-hydrate-empty', {
          tailLoaded,
          threadId: expectedThreadId,
        });
        return {
          ...cachedPage,
          cacheCoverage,
          expectedReplyCount: authoritativeExpectedReplyCount,
          relationSnapshotComplete: cachedRelationSnapshotComplete,
          snapshotComplete,
          tailLoaded,
        };
      }

      setSupplementalThreadEvents(expectedThreadId, cachedEvents);
      saveThreadOpenSeedSnapshot(room, expectedThreadId, cachedEvents);
      forceTimelineUpdate();
      setThreadTimelineTick((val) => val + 1);
      logTimelineDebug(debugTraceId, 'thread-cache-hydrate-applied', {
        appliedCount: cachedEvents.length,
        expectedReplyCount: authoritativeExpectedReplyCount ?? null,
        hasMoreBefore: cachedPage.hasMoreBefore,
        relationSnapshotComplete: cachedRelationSnapshotComplete,
        snapshotComplete,
        tailLoaded,
        threadId: expectedThreadId,
      });
      return {
        ...cachedPage,
        cacheCoverage,
        expectedReplyCount: authoritativeExpectedReplyCount,
        relationSnapshotComplete: cachedRelationSnapshotComplete,
        snapshotComplete,
        tailLoaded,
      };
    },
    [
      alive,
      debugTraceId,
      forceTimelineUpdate,
      mx,
      room,
      safePaginationLimitRef,
      sessionId,
      setSupplementalThreadEvents,
      setThreadHasMoreCachedBack,
      setThreadTimelineTick,
      threadIdRef,
    ]
  );

  const refreshLatestThreadSlice = useCallback(
    async (
      expectedThreadId: string,
      opts?: {
        allowWhenThreadClosed?: boolean;
      }
    ): Promise<boolean> => {
      const allowWhenThreadClosed = opts?.allowWhenThreadClosed === true;
      let currentThread = room.getThread(expectedThreadId);
      if (!currentThread && allowWhenThreadClosed) {
        const [threadErr] = await to(
          mx.getThreadTimeline(room.getUnfilteredTimelineSet(), expectedThreadId)
        );
        if (threadErr) return false;
        currentThread = room.getThread(expectedThreadId);
      }
      if (!currentThread) return false;
      const shouldAbortRefresh = () => {
        if (!alive() || roomIdRef.current !== room.roomId) return true;
        if (allowWhenThreadClosed) {
          return !!threadIdRef.current && threadIdRef.current !== expectedThreadId;
        }
        return threadIdRef.current !== expectedThreadId;
      };

      const threadTimelineSet = currentThread.getUnfilteredTimelineSet();
      for (let iteration = 0; iteration < MAX_THREAD_FETCH_ITERATIONS; iteration += 1) {
        if (shouldAbortRefresh()) return false;

        const linkedTimelines = getLinkedTimelines(threadTimelineSet.getLiveTimeline());
        const firstTimeline = linkedTimelines[0];
        if (!firstTimeline?.getPaginationToken(Direction.Backward)) break;

        const [err, didPaginate] = await to(
          mx.paginateEventTimeline(firstTimeline, {
            backwards: true,
            limit: THREAD_BATCH_SIZE,
          })
        );
        if (err || didPaginate === false) break;
      }

      if (shouldAbortRefresh()) return false;

      const allEvents = currentThread.events;
      const rootEvent = currentThread.rootEvent ?? room.findEventById(expectedThreadId);
      const firstThreadTimeline = getLinkedTimelines(threadTimelineSet.getLiveTimeline())[0];
      const backwardToken = firstThreadTimeline?.getPaginationToken(Direction.Backward) ?? null;
      const snapshotComplete = isCompleteCachedThreadSnapshot({
        room,
        threadId: expectedThreadId,
        rootEvent: rootEvent ?? undefined,
        cachedRootEvent: rootEvent ?? undefined,
        cachedEvents: rootEvent ? [rootEvent, ...allEvents] : allEvents,
        beforeToken: backwardToken,
        hasMoreBefore: typeof backwardToken === 'string',
        expectedReplyCount: rootEvent ? getKnownThreadReplyCount(rootEvent) : undefined,
        snapshotComplete: typeof backwardToken !== 'string',
        tailLoaded: true,
      });

      if (allEvents.length > 0) {
        setSupplementalThreadEvents(expectedThreadId, allEvents);
        saveThreadOpenSeedSnapshot(room, expectedThreadId, allEvents);
        persistThreadEventCache(
          expectedThreadId,
          allEvents,
          rootEvent,
          backwardToken,
          true,
          snapshotComplete
        );
      }

      if (firstThreadTimeline) {
        reconcileThreadBackwardPagination(
          firstThreadTimeline,
          backwardToken,
          setThreadHasMoreCachedBack
        );
      }

      forceTimelineUpdate();
      setThreadTimelineTick((val) => val + 1);
      setThreadTailLoaded(true);
      logTimelineDebug(debugTraceId, 'thread-refresh-latest-complete', {
        snapshotComplete,
        persistedCount: allEvents.length,
        tailLoaded: true,
        threadId: expectedThreadId,
        backwardTokenPresent: typeof backwardToken === 'string',
      });
      return true;
    },
    [
      alive,
      debugTraceId,
      forceTimelineUpdate,
      mx,
      persistThreadEventCache,
      room,
      roomIdRef,
      setSupplementalThreadEvents,
      setThreadHasMoreCachedBack,
      setThreadTailLoaded,
      setThreadTimelineTick,
      threadIdRef,
    ]
  );

  const backfillThreadRelationsIntoCache = useCallback(
    async (
      expectedThreadId: string,
      cachedRootEvent?: Partial<IEvent>,
      baselineEvents: MatrixEvent[] = [],
      expectedReplyCount?: number
    ): Promise<{ completed: boolean; fetchedCount: number } | undefined> => {
      const liveRootEvent =
        room.getThread(expectedThreadId)?.rootEvent ?? room.findEventById(expectedThreadId);
      const mapper = mx.getEventMapper();
      const mappedCachedRootEvent =
        !liveRootEvent && cachedRootEvent ? mapper(cachedRootEvent) : undefined;
      const rootEvent = liveRootEvent ?? mappedCachedRootEvent;
      if (!rootEvent) return undefined;

      logTimelineDebug(debugTraceId, 'thread-relations-backfill-start', {
        threadId: expectedThreadId,
      });

      const relationPageResult = await fetchAllThreadRelations(
        mx,
        room.roomId,
        expectedThreadId,
        THREAD_BATCH_SIZE,
        () => !alive() || threadIdRef.current !== expectedThreadId
      );
      if (!relationPageResult || !alive() || threadIdRef.current !== expectedThreadId) {
        return undefined;
      }

      const relationSnapshotComplete = typeof relationPageResult.nextBatchToken !== 'string';
      const mergedEvents = mergeThreadBackfillEvents(baselineEvents, relationPageResult.events);
      const snapshotComplete = isCompleteCachedThreadSnapshot({
        room,
        threadId: expectedThreadId,
        rootEvent: liveRootEvent,
        cachedRootEvent: mappedCachedRootEvent,
        cachedEvents: mergedEvents,
        beforeToken: relationPageResult.nextBatchToken ?? null,
        hasMoreBefore: typeof relationPageResult.nextBatchToken === 'string',
        expectedReplyCount,
        snapshotComplete: relationSnapshotComplete,
        tailLoaded: true,
      });
      const relationCoverage = buildThreadCacheCoverage({
        eventCount: mergedEvents.length + (rootEvent ? 1 : 0),
        backwardToken: relationPageResult.nextBatchToken ?? null,
        hasMoreBackward: typeof relationPageResult.nextBatchToken === 'string',
        expectedReplyCount,
        relationSnapshotComplete,
        snapshotComplete,
        tailLoaded: true,
      });
      const currentThreadTimelineSet = room.getThread(expectedThreadId)?.getUnfilteredTimelineSet();
      const firstThreadTimeline = currentThreadTimelineSet
        ? getLinkedTimelines(currentThreadTimelineSet.getLiveTimeline())[0]
        : undefined;
      const hadStaleSdkBackwardToken =
        firstThreadTimeline?.getPaginationToken(Direction.Backward) != null;
      if (snapshotComplete && firstThreadTimeline && hadStaleSdkBackwardToken) {
        firstThreadTimeline.setPaginationToken(null, Direction.Backward);
        logTimelineDebug(debugTraceId, 'thread-relations-backfill-clear-backward-gap', {
          threadId: expectedThreadId,
        });
      }
      setSupplementalThreadEvents(expectedThreadId, mergedEvents);
      saveThreadOpenSeedSnapshot(room, expectedThreadId, mergedEvents);
      persistThreadEventCache(
        expectedThreadId,
        mergedEvents,
        rootEvent,
        relationPageResult.nextBatchToken ?? null,
        true,
        snapshotComplete,
        expectedReplyCount,
        relationSnapshotComplete
      );
      setThreadHasMoreCachedBack(hasThreadCacheBackwardGap(relationCoverage));
      setThreadTailLoaded(true);
      forceTimelineUpdate();
      setThreadTimelineTick((val) => val + 1);
      logTimelineDebug(debugTraceId, 'thread-relations-backfill-complete', {
        fetchedCount: relationPageResult.events.length,
        mergedCount: mergedEvents.length,
        relationSnapshotComplete,
        snapshotComplete,
        threadId: expectedThreadId,
        nextBatchPresent: typeof relationPageResult.nextBatchToken === 'string',
      });

      return {
        completed: snapshotComplete,
        fetchedCount: relationPageResult.events.length,
      };
    },
    [
      alive,
      debugTraceId,
      forceTimelineUpdate,
      mx,
      persistThreadEventCache,
      room,
      setSupplementalThreadEvents,
      setThreadHasMoreCachedBack,
      setThreadTailLoaded,
      setThreadTimelineTick,
      threadIdRef,
    ]
  );

  const refreshLatestThreadRelationsTail = useCallback(
    async (expectedThreadId: string, cachedPage: HydratedThreadCachePage): Promise<boolean> => {
      const [err, relData] = await to(
        mx.fetchRelations(room.roomId, expectedThreadId, null, null, {
          dir: Direction.Backward,
          limit: THREAD_BATCH_SIZE,
          recurse: true,
        })
      );
      if (err || !relData || !alive() || threadIdRef.current !== expectedThreadId) {
        return false;
      }

      const mapper = mx.getEventMapper();
      const latestRelationEvents = relData.chunk
        .slice()
        .reverse()
        .map((rawEvent) => mapper(rawEvent));
      if (latestRelationEvents.length === 0) {
        logTimelineDebug(debugTraceId, 'thread-refresh-latest-tail-empty', {
          threadId: expectedThreadId,
        });
        return false;
      }

      const cachedSnapshotEvents = mapCachedThreadPageEvents({
        events: cachedPage.events,
        rootEvent: cachedPage.rootEvent,
        mapEvent: (rawEvent) => mapper(rawEvent),
      });
      const liveThreadTimelineSet = room.getThread(expectedThreadId)?.getUnfilteredTimelineSet();
      const redactedRelationTargets = collectRedactedRelationTargetsFromLookup(
        latestRelationEvents,
        cachedSnapshotEvents
      );
      reconcileRelationEventsWithAggregation(
        latestRelationEvents,
        [
          { relations: roomTimelineSet.relations, timelineSet: roomTimelineSet },
          liveThreadTimelineSet
            ? { relations: liveThreadTimelineSet.relations, timelineSet: liveThreadTimelineSet }
            : undefined,
        ],
        undefined,
        redactedRelationTargets
      );
      const mergedEvents = mergeThreadBackfillEvents(cachedSnapshotEvents, latestRelationEvents);
      const liveRootEvent =
        room.getThread(expectedThreadId)?.rootEvent ?? room.findEventById(expectedThreadId);
      const mappedCachedRootEvent =
        !liveRootEvent && cachedPage.rootEvent ? mapper(cachedPage.rootEvent) : undefined;
      const rootEvent =
        liveRootEvent ??
        mappedCachedRootEvent ??
        mergedEvents.find((mEvent) => mEvent.getId() === expectedThreadId);

      setSupplementalThreadEvents(expectedThreadId, mergedEvents);
      saveThreadOpenSeedSnapshot(room, expectedThreadId, mergedEvents);
      persistThreadEventCache(
        expectedThreadId,
        mergedEvents,
        rootEvent,
        cachedPage.beforeToken ?? null,
        cachedPage.tailLoaded === true,
        cachedPage.snapshotComplete === true,
        cachedPage.expectedReplyCount,
        cachedPage.relationSnapshotComplete === true
      );
      forceTimelineUpdate();
      setThreadTimelineTick((val) => val + 1);
      logTimelineDebug(debugTraceId, 'thread-refresh-latest-tail-complete', {
        fetchedCount: latestRelationEvents.length,
        mergedCount: mergedEvents.length,
        threadId: expectedThreadId,
      });
      return true;
    },
    [
      alive,
      debugTraceId,
      forceTimelineUpdate,
      mx,
      persistThreadEventCache,
      room,
      roomTimelineSet,
      setSupplementalThreadEvents,
      setThreadTimelineTick,
      threadIdRef,
    ]
  );

  return {
    backfillThreadRelationsIntoCache,
    hydrateThreadFromCache,
    refreshLatestThreadRelationsTail,
    refreshLatestThreadSlice,
  };
};
