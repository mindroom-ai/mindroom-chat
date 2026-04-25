import { Direction, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { Dispatch, SetStateAction } from 'react';
import to from 'await-to-js';
import { THREAD_BATCH_SIZE } from '../../state/settings';
import {
  computeReconciliationToken,
  reconcileThreadBackwardPagination,
} from '../../features/room/threadPaginationUtils';
import { getLinkedTimelines } from './timelinePagination';
import { logTimelineDebug } from '../../features/room/timelineDebug';

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

type RunThreadOpenPostBootstrapRefreshOptions = {
  debugTraceId: string | undefined;
  isCurrentThreadOpen: () => boolean;
  mx: MatrixClient;
  persistThreadEventCache: PersistThreadEventCache;
  refreshLatestThreadSlice: (threadId: string) => Promise<boolean>;
  room: Room;
  setSupplementalThreadEvents: (threadId: string, events: MatrixEvent[]) => void;
  setThreadHasMoreCachedBack: Dispatch<SetStateAction<boolean>>;
  setThreadTailLoaded: Dispatch<SetStateAction<boolean>>;
  shouldScrollToLatestOnOpen: boolean;
  threadId: string;
};

export const runThreadOpenPostBootstrapRefresh = async ({
  debugTraceId,
  isCurrentThreadOpen,
  mx,
  persistThreadEventCache,
  refreshLatestThreadSlice,
  room,
  setSupplementalThreadEvents,
  setThreadHasMoreCachedBack,
  setThreadTailLoaded,
  shouldScrollToLatestOnOpen,
  threadId,
}: RunThreadOpenPostBootstrapRefreshOptions): Promise<boolean> => {
  if (shouldScrollToLatestOnOpen) {
    await refreshLatestThreadSlice(threadId);
    return isCurrentThreadOpen();
  }

  const currentThread = room.getThread(threadId);
  if (currentThread) {
    const [relErr, relData] = await to(
      mx.fetchRelations(room.roomId, threadId, 'm.thread' as any, null, {
        dir: Direction.Backward,
        limit: THREAD_BATCH_SIZE,
      })
    );
    if (!isCurrentThreadOpen()) return false;
    if (!relErr && relData) {
      const mapper = mx.getEventMapper();
      const latestEvents = relData.chunk
        .slice()
        .reverse()
        .map((rawEvent: Parameters<typeof mapper>[0]) => mapper(rawEvent));
      if (latestEvents.length > 0) {
        currentThread.addEvents(latestEvents, false);
        setSupplementalThreadEvents(threadId, latestEvents);
      }

      const currentFirstTimeline = getLinkedTimelines(
        currentThread.getUnfilteredTimelineSet().getLiveTimeline()
      )[0];
      persistThreadEventCache(
        threadId,
        latestEvents,
        currentThread.rootEvent,
        relData.next_batch ?? null
      );

      if (currentFirstTimeline) {
        const reconcileToken = computeReconciliationToken(
          relData.next_batch ?? null,
          latestEvents,
          currentThread.events,
          threadId
        );
        reconcileThreadBackwardPagination(
          currentFirstTimeline,
          reconcileToken,
          setThreadHasMoreCachedBack
        );
      }
    }
  }

  const hasForwardGap = !!room
    .getThread(threadId)
    ?.getUnfilteredTimelineSet()
    .getLiveTimeline()
    .getPaginationToken(Direction.Forward);
  if (!hasForwardGap) {
    setThreadTailLoaded(true);
  }
  logTimelineDebug(debugTraceId, 'thread-open-forward-gap-check', {
    hasForwardGap,
    threadId,
  });
  return true;
};
