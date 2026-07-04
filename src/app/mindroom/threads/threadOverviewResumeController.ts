import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { THREAD_BATCH_SIZE } from './preloadSettings';
import { usePageResume } from './usePageResume';
import { loadRoomThreads } from './roomThreadList';
import { logTimelineDebug } from './timelineDebug';
import {
  getLatestThreadSummaryInfoFromEventSources,
  type MindroomThreadSummaryInfo,
} from '../messages/threadSummary';
import { fetchAllThreadRelations } from '../engine';
import { isCompleteCachedThreadSnapshot } from './threadCacheSnapshot';
import { saveThreadOpenSeedSnapshot } from './threadOpenSeedCache';
import { getKnownThreadReplyCount } from './threadRecord';
import { resolveThreadOverviewRefreshTargets } from './threadOverviewRefreshTargets';
import type { TimelineEventEntry } from './roomTimelineEvents';
import type { Timeline } from './timelinePagination';
import type { FetchedRelationOverviewUpdateOptions } from './threadOverviewCacheHydration';
import { useMindroomSyncEngine } from '../engine';

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

export const useThreadOverviewResumeController = ({
  alive,
  activeTimelineRange,
  compactFilteredThreadRootIds,
  compactViewRequested,
  debugTraceId,
  filteredThreadRootIds,
  limit,
  mx,
  onStoreThreadSummary,
  onApplyThreadRelations,
  persistThreadEventCache,
  refreshCompactThreadList,
  room,
  setOverviewRefreshCounter,
  showCompactRoomView,
  threadFilteredEventEntries,
  threadId,
  threadIdRef,
  threadReplyCountMap,
  threadResolutionMap,
}: {
  alive: () => boolean;
  activeTimelineRange: Timeline['range'];
  compactFilteredThreadRootIds: string[];
  compactViewRequested: boolean;
  debugTraceId: string;
  filteredThreadRootIds: string[];
  limit: number;
  mx: MatrixClient;
  onStoreThreadSummary: (threadRootId: string, info: MindroomThreadSummaryInfo | undefined) => void;
  onApplyThreadRelations: (options: FetchedRelationOverviewUpdateOptions) => void;
  persistThreadEventCache: PersistThreadEventCache;
  refreshCompactThreadList: () => Promise<void>;
  room: Room;
  setOverviewRefreshCounter: Dispatch<SetStateAction<number>>;
  showCompactRoomView: boolean;
  threadFilteredEventEntries: TimelineEventEntry[];
  threadId: string | undefined;
  threadIdRef: MutableRefObject<string | undefined>;
  threadReplyCountMap: Map<string, number>;
  threadResolutionMap: Map<string, { isResolved: boolean }>;
}): void => {
  const syncEngine = useMindroomSyncEngine();
  // CINNY-207 P4.4: the `overviewResumeRefreshInFlightRef` and
  // `pendingOverviewResumeRefreshRef` in-flight-guards are gone —
  // per-thread fetch dedup is now the engine scheduler's job
  // (kind: 'thread-backfill'), and the resume trigger is naturally
  // rate-limited by the 1s window below plus the scheduler's dedup.
  const lastOverviewResumeRefreshTsRef = useRef(0);
  const { overviewResumeRefreshIds: targetThreadIds } = useMemo(
    () =>
      resolveThreadOverviewRefreshTargets({
        activeTimelineRange,
        compactFilteredThreadRootIds,
        filteredThreadRootIds,
        limit,
        room,
        showCompactRoomView,
        threadFilteredEventEntries,
        threadId,
        threadReplyCountMap,
        threadResolutionMap,
      }),
    [
      activeTimelineRange,
      compactFilteredThreadRootIds,
      filteredThreadRootIds,
      limit,
      room,
      showCompactRoomView,
      threadFilteredEventEntries,
      threadId,
      threadReplyCountMap,
      threadResolutionMap,
    ]
  );

  useEffect(() => {
    lastOverviewResumeRefreshTsRef.current = 0;
  }, [room.roomId]);

  // CINNY-207 P4.4: route each per-thread refresh through the engine
  // scheduler as a `thread-backfill` job. AC8 dedup means a resume
  // that triggers during an in-flight overview refresh — or two
  // resume-driven refreshes for the same thread from different code
  // paths — reuses the same promise instead of firing two /relations
  // requests. The rest of the callback (parse response, persist,
  // notify onApplyThreadRelations) stays exactly the same shape it
  // had before; only the fetch is deduped.
  const refreshOverviewThreadCacheFromRelations = useCallback(
    (expectedThreadId: string): Promise<void> =>
      syncEngine.scheduler.enqueue<void>({
        roomId: room.roomId,
        threadId: expectedThreadId,
        kind: 'thread-backfill',
        // Priority 2 = "recently-active my-server tails" band. Overview
        // resume is user-triggered (page focus / online / visibility)
        // so it beats prewarm (band 3) but yields to the current
        // room's own gap-fill (band 0-1).
        priority: 2,
        execute: async () => {
          const rootEvent =
            room.getThread(expectedThreadId)?.rootEvent ?? room.findEventById(expectedThreadId);
          if (!rootEvent) return;

          const relationPageResult = await fetchAllThreadRelations(
            mx,
            room.roomId,
            expectedThreadId,
            THREAD_BATCH_SIZE,
            () => !alive() || (!!threadIdRef.current && threadIdRef.current !== expectedThreadId)
          );
          if (
            !relationPageResult ||
            !alive() ||
            (!!threadIdRef.current && threadIdRef.current !== expectedThreadId)
          ) {
            return;
          }

          const relationEvents = relationPageResult.events;
          const relationSnapshotComplete = typeof relationPageResult.nextBatchToken !== 'string';
          const expectedReplyCount = getKnownThreadReplyCount(rootEvent);
          const snapshotComplete = isCompleteCachedThreadSnapshot({
            room,
            threadId: expectedThreadId,
            rootEvent,
            cachedRootEvent: rootEvent,
            cachedEvents: rootEvent ? [rootEvent, ...relationEvents] : relationEvents,
            beforeToken: relationPageResult.nextBatchToken ?? null,
            hasMoreBefore: typeof relationPageResult.nextBatchToken === 'string',
            expectedReplyCount,
            snapshotComplete: relationSnapshotComplete,
            tailLoaded: true,
          });

          if (relationEvents.length > 0) {
            saveThreadOpenSeedSnapshot(room, expectedThreadId, relationEvents);
          }

          onApplyThreadRelations({
            rootId: expectedThreadId,
            room,
            events: relationEvents,
            rootEvent,
            beforeToken: relationPageResult.nextBatchToken ?? null,
            tailLoaded: true,
            snapshotComplete,
            expectedReplyCount,
            relationSnapshotComplete,
          });

          persistThreadEventCache(
            expectedThreadId,
            relationEvents,
            rootEvent,
            relationPageResult.nextBatchToken ?? null,
            true,
            snapshotComplete,
            expectedReplyCount,
            relationSnapshotComplete
          );

          const summaryInfo = getLatestThreadSummaryInfoFromEventSources(relationEvents);
          if (summaryInfo?.summaryText) {
            onStoreThreadSummary(expectedThreadId, summaryInfo);
          }
        },
      }),
    [
      alive,
      mx,
      onApplyThreadRelations,
      onStoreThreadSummary,
      persistThreadEventCache,
      room,
      syncEngine,
      threadIdRef,
    ]
  );

  const refreshOverviewThreadsOnResume = useCallback(
    (reason: 'focus' | 'online' | 'pageshow' | 'visibility') => {
      if (threadId) return;
      if (!compactViewRequested && targetThreadIds.length === 0) return;

      const now = Date.now();
      if (now - lastOverviewResumeRefreshTsRef.current < 1_000) return;
      lastOverviewResumeRefreshTsRef.current = now;

      // CINNY-207 P4.4: no more in-flight/pending refs. The scheduler
      // dedupes per (roomId, threadId, 'thread-backfill'), so
      // launching a new resume while a previous one is still draining
      // is safe — each per-thread job returns the existing in-flight
      // promise. The 1s rate-limit above still guards against
      // burst-fire from stacked resume signals (visibility + focus
      // firing in quick succession).
      const runRefresh = async () => {
        logTimelineDebug(debugTraceId, 'overview-thread-resume-refresh-start', {
          compactViewRequested,
          reason,
          targetCount: targetThreadIds.length,
        });

        try {
          if (compactViewRequested) {
            await refreshCompactThreadList();
          } else {
            await loadRoomThreads(room);
          }

          if (!alive() || threadIdRef.current) return;

          for (const expectedThreadId of targetThreadIds) {
            if (!alive() || threadIdRef.current) return;
            // eslint-disable-next-line no-await-in-loop
            await refreshOverviewThreadCacheFromRelations(expectedThreadId);
          }

          setOverviewRefreshCounter((value) => value + 1);
          logTimelineDebug(debugTraceId, 'overview-thread-resume-refresh-complete', {
            compactViewRequested,
            reason,
            targetCount: targetThreadIds.length,
          });
        } catch (error) {
          logTimelineDebug(debugTraceId, 'overview-thread-resume-refresh-error', {
            compactViewRequested,
            error: error instanceof Error ? error.message : String(error),
            reason,
            targetCount: targetThreadIds.length,
          });
        }
      };

      void runRefresh();
    },
    [
      alive,
      compactViewRequested,
      debugTraceId,
      refreshCompactThreadList,
      refreshOverviewThreadCacheFromRelations,
      room,
      setOverviewRefreshCounter,
      targetThreadIds,
      threadId,
      threadIdRef,
    ]
  );

  usePageResume(refreshOverviewThreadsOnResume);
};
