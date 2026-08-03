import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { Direction, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import to from 'await-to-js';
import { THREAD_BATCH_SIZE } from './preloadSettings';
import { logTimelineDebug } from './timelineDebug';
import { getLinkedTimelines } from './timelinePagination';
import { reconcileThreadBackwardPagination } from './threadPaginationUtils';
import { createPreferLiveEventMapper, loadThreadCachedSnapshot } from './eventRepository';
import { MAX_THREAD_FETCH_ITERATIONS } from './threadBootstrap';
import {
  getAuthoritativeCachedThreadReplyCount,
  isCompleteCachedThreadSnapshot,
} from './threadCacheSnapshot';
import {
  buildThreadCacheCoverage,
  hasThreadCacheBackwardGap,
  hasThreadCacheKnownBackwardStart,
} from './threadCacheCoverage';
import { saveThreadOpenSeedSnapshot } from './threadOpenSeedCache';
import { getKnownThreadReplyCount } from './threadRecord';
import type { HydratedThreadCachePage } from './types';

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
  hydrateThreadFromCache: (
    expectedThreadId: string
  ) => Promise<HydratedThreadCachePage | undefined>;
  // CINNY-207 P5.1: `refreshLatestThreadRelationsTail` is gone — the
  // engine reconciler (`scheduleReconcile`) owns the post-open server
  // verify. This controller only reads/paints now; write-side is fully
  // engine-owned.
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
  // CINNY-207 P5.1: `roomTimelineSet` used to be plumbed through here
  // for `refreshLatestThreadRelationsTail`'s aggregation reconcile
  // call. That method moved to `engine/reconciler.ts` — the reconciler
  // reads the room's timeline set from `room.getThread(...)` when it
  // needs one. The controller no longer touches it.
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
        limit: THREAD_BATCH_SIZE,
        threadId: expectedThreadId,
      });
      const mapper = mx.getEventMapper();
      const cachedSnapshot = await loadThreadCachedSnapshot({
        sessionId,
        roomId: room.roomId,
        threadId: expectedThreadId,
        // CINNY-207 PR #72 review (greptile P2): paint-time cache reads
        // use the interactive batch bound. `prefetchDepth` (default
        // 10_000) governs only the BACKGROUND deep-history job — using
        // it here paged thousands of IDB records into memory before
        // first paint on deep threads.
        limit: THREAD_BATCH_SIZE,
        maxPages: MAX_THREAD_FETCH_ITERATIONS,
        mapEvent: createPreferLiveEventMapper(room, mapper),
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
        expectedReplyCountSnapshotTs:
          authoritativeExpectedReplyCount === cachedPage.expectedReplyCount
            ? cachedPage.expectedReplyCountSnapshotTs
            : undefined,
        relationSnapshotComplete: cachedRelationSnapshotComplete,
        snapshotComplete,
        tailLoaded,
      });
      const currentThreadTimelineSet = room.getThread(expectedThreadId)?.getUnfilteredTimelineSet();
      const currentFirstThreadTimeline = currentThreadTimelineSet
        ? getLinkedTimelines(currentThreadTimelineSet.getLiveTimeline())[0]
        : undefined;
      // 2026-07-06 review finding #1: clearing the SDK's backward token
      // requires the RELATIONS-proven completeness proof, not just the
      // reply-count proof — see the matching gate in
      // threadOpenCacheFirst.ts (count-proof can be vacuous under a
      // stale expectedReplyCount; the token is the escape hatch).
      const cacheProvesNoBackwardGap =
        snapshotComplete === true &&
        cachedRelationSnapshotComplete &&
        hasThreadCacheKnownBackwardStart(cacheCoverage);
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
      // CINNY-207 P5-GATE-FIX v2 (AC2 instance-race): expose the exact
      // MatrixEvent instances the render layer just received via
      // `setSupplementalThreadEvents`. On complete-coverage cache-first
      // reopens the SDK bootstrap is skipped by design, so these clones
      // ARE the render's source of truth — the reconciler must apply
      // `makeReplaced`/`makeRedacted` against them (not fresh remaps)
      // for the repair to become visible. See engine/reconciler.ts.
      return {
        ...cachedPage,
        cacheCoverage,
        expectedReplyCount: authoritativeExpectedReplyCount,
        hydratedEvents: cachedEvents,
        hydratedRootEvent: cachedRootMatrixEvent,
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

  return {
    hydrateThreadFromCache,
    refreshLatestThreadSlice,
  };
};
