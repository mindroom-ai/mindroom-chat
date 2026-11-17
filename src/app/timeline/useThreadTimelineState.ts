import { useEffect, useMemo, useReducer } from 'react';
import { Direction, MatrixEvent, Room } from 'matrix-js-sdk';
import { observeActiveThreadSyncGaps } from '../threads/open/activeThreadSyncGaps';
import { getLinkedTimelines } from '../event-store/timeline/linkedTimelines';
import { useThreadRenderState } from './useThreadRenderState';

export type UseThreadTimelineStateOptions = {
  room: Room;
  threadId?: string;
  threadInitialCacheHydrated: boolean;
  threadInitialSdkLoaded?: boolean;
  /** The open holds its first paint: no rows yet. */
  threadFirstPaintHeld?: boolean;
  timelineRevision?: number;
  debugTraceId?: string;
  /** A fork's parent messages up to its fork point, shown before its own. */
  prefixEvents?: MatrixEvent[];
  /** A fork draft's fork point, where the rows end. */
  forkAt?: string;
};

export const useThreadTimelineState = ({
  room,
  threadId,
  threadInitialCacheHydrated,
  threadInitialSdkLoaded,
  threadFirstPaintHeld,
  timelineRevision,
  debugTraceId,
  prefixEvents,
  forkAt,
}: UseThreadTimelineStateOptions) => {
  const thread = threadId ? room.getThread(threadId) : null;
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);
  useEffect(() => {
    if (!thread) return undefined;
    return observeActiveThreadSyncGaps(room, thread, refresh);
  }, [room, thread]);
  const roomTimelineSet = room.getUnfilteredTimelineSet();
  const threadTimelineSet = thread?.getUnfilteredTimelineSet();
  const threadLinkedTimelines = threadTimelineSet
    ? getLinkedTimelines(threadTimelineSet.getLiveTimeline())
    : [];
  const lastThreadTimeline = threadLinkedTimelines[threadLinkedTimelines.length - 1];
  const threadRenderState = useThreadRenderState({
    room,
    roomTimelineSet,
    threadTimelineSet,
    threadId,
    thread,
    threadInitialCacheHydrated,
    threadInitialSdkLoaded,
    threadFirstPaintHeld,
    timelineRevision,
    debugTraceId,
    prefixEvents,
    forkAt,
  });

  const threadEventMap = useMemo(() => {
    const eventMap = new Map<string, MatrixEvent>();
    threadRenderState.threadEvents.forEach((mEvent) => {
      const eventId = mEvent.getId();
      if (eventId) eventMap.set(eventId, mEvent);
    });
    return eventMap;
  }, [threadRenderState.threadEvents]);

  const threadBackwardPaginationToken =
    threadLinkedTimelines[0]?.getPaginationToken(Direction.Backward) ?? null;
  const canPaginateThreadBack = typeof threadBackwardPaginationToken === 'string';
  const canPaginateThreadFront =
    typeof lastThreadTimeline?.getPaginationToken(Direction.Forward) === 'string';

  return {
    ...threadRenderState,
    canPaginateThreadBack,
    canPaginateThreadFront,
    roomTimelineSet,
    thread,
    threadBackwardPaginationToken,
    threadEventMap,
    threadTimelineSet,
  };
};
