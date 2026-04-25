import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { THREAD_BATCH_SIZE } from '../../state/settings';
import { usePageResume } from '../../hooks/usePageResume';
import { loadRoomThreads } from './roomThreadList';
import { logTimelineDebug } from './timelineDebug';
import {
  getLatestThreadSummaryInfoFromEventSources,
  type MindroomThreadSummaryInfo,
} from '../../components/message/mindroomThreadSummary';
import { fetchAllThreadRelations } from './threadBootstrap';
import { isCompleteCachedThreadSnapshot } from './threadCacheSnapshot';
import { saveThreadOpenSeedSnapshot } from './threadOpenSeedCache';
import { getKnownThreadReplyCount } from './threadRecord';

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
  compactViewRequested,
  debugTraceId,
  mx,
  onStoreThreadSummary,
  persistThreadEventCache,
  refreshCompactThreadList,
  room,
  setOverviewRefreshCounter,
  setSupplementalThreadEvents,
  targetThreadIds,
  threadId,
  threadIdRef,
}: {
  alive: () => boolean;
  compactViewRequested: boolean;
  debugTraceId: string;
  mx: MatrixClient;
  onStoreThreadSummary: (
    threadRootId: string,
    info: MindroomThreadSummaryInfo | undefined
  ) => void;
  persistThreadEventCache: PersistThreadEventCache;
  refreshCompactThreadList: () => Promise<void>;
  room: Room;
  setOverviewRefreshCounter: Dispatch<SetStateAction<number>>;
  setSupplementalThreadEvents: (threadId: string, events: MatrixEvent[]) => void;
  targetThreadIds: string[];
  threadId: string | undefined;
  threadIdRef: MutableRefObject<string | undefined>;
}): void => {
  const overviewResumeRefreshInFlightRef = useRef(false);
  const pendingOverviewResumeRefreshRef = useRef(false);
  const lastOverviewResumeRefreshTsRef = useRef(0);

  useEffect(() => {
    overviewResumeRefreshInFlightRef.current = false;
    pendingOverviewResumeRefreshRef.current = false;
    lastOverviewResumeRefreshTsRef.current = 0;
  }, [room.roomId]);

  const refreshOverviewThreadCacheFromRelations = useCallback(
    async (expectedThreadId: string): Promise<void> => {
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
        setSupplementalThreadEvents(expectedThreadId, relationEvents);
        saveThreadOpenSeedSnapshot(room, expectedThreadId, relationEvents);
      }

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
    [alive, mx, onStoreThreadSummary, persistThreadEventCache, room, setSupplementalThreadEvents, threadIdRef]
  );

  const refreshOverviewThreadsOnResume = useCallback(
    (reason: 'focus' | 'online' | 'pageshow' | 'visibility') => {
      if (threadId) return;
      if (!compactViewRequested && targetThreadIds.length === 0) return;

      const now = Date.now();
      if (
        !overviewResumeRefreshInFlightRef.current &&
        now - lastOverviewResumeRefreshTsRef.current < 1_000
      ) {
        return;
      }
      lastOverviewResumeRefreshTsRef.current = now;

      if (overviewResumeRefreshInFlightRef.current) {
        pendingOverviewResumeRefreshRef.current = true;
        return;
      }

      const runRefresh = async () => {
        overviewResumeRefreshInFlightRef.current = true;
        pendingOverviewResumeRefreshRef.current = false;
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
        } finally {
          overviewResumeRefreshInFlightRef.current = false;

          if (pendingOverviewResumeRefreshRef.current && !threadIdRef.current) {
            queueMicrotask(() => {
              refreshOverviewThreadsOnResume(reason);
            });
          }
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
