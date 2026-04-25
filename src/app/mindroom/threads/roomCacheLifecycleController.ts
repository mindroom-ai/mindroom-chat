import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Direction, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { logTimelineDebug } from '../../features/room/timelineDebug';
import { type Timeline } from '../../features/room/timelinePagination';
import {
  findEarliestLoadedRoomEventByCacheOrder,
  getEarliestLoadedRoomEvent,
  getMainTimelineCacheEvents,
  getThreadCacheTargetId,
  loadRoomCachePersistenceState,
  loadRoomCachedBackStateSnapshot,
  persistRoomEventCacheSnapshot,
} from './eventRepository';
import type { ThreadCachePersistenceController } from './threadCachePersistenceController';

export type PersistRoomEventCache = (
  events: MatrixEvent[],
  beforeTokenForEarliest?: string | null
) => void;

export const useRoomCacheLifecycleController = ({
  alive,
  eventId,
  eventsLength,
  persistThreadCacheFromRoomEvents,
  room,
  roomDebugTraceId,
  roomIdRef,
  sessionId,
  setRoomHasMoreCachedBack,
  setTimeline,
  threadId,
  threadIdRef,
  timeline,
}: {
  alive: () => boolean;
  eventId?: string;
  eventsLength: number;
  persistThreadCacheFromRoomEvents: ThreadCachePersistenceController['persistThreadCacheFromRoomEvents'];
  room: Room;
  roomDebugTraceId: string;
  roomIdRef: MutableRefObject<string>;
  sessionId: string;
  setRoomHasMoreCachedBack: Dispatch<SetStateAction<boolean>>;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
  threadId: string | undefined;
  threadIdRef: MutableRefObject<string | undefined>;
  timeline: Timeline;
}): { persistRoomEventCache: PersistRoomEventCache } => {
  const persistRoomEventCache = useCallback<PersistRoomEventCache>(
    (events, beforeTokenForEarliest) => {
      const snapshot = persistRoomEventCacheSnapshot({
        sessionId,
        room,
        events,
        beforeTokenForEarliest,
      });
      logTimelineDebug(roomDebugTraceId, 'room-cache-persist', {
        beforeTokenForEarliest: beforeTokenForEarliest ?? null,
        rawEventCount: snapshot.rawEvents.length,
        sourceEventCount: snapshot.sourceEventCount,
      });
    },
    [room, roomDebugTraceId, sessionId]
  );

  useEffect(() => {
    if (threadId) return undefined;
    let cancelled = false;

    const persistCurrentRoomCache = async () => {
      const currentLinkedTimelines = timeline.linkedTimelines;
      const cacheEvents = getMainTimelineCacheEvents(room, currentLinkedTimelines);
      const threadCacheEvents = currentLinkedTimelines.flatMap((timelineItem) =>
        timelineItem.getEvents().filter((mEvent) => !!getThreadCacheTargetId(room, mEvent))
      );
      const earliestLoadedEvent = findEarliestLoadedRoomEventByCacheOrder(cacheEvents);
      const firstTimeline = currentLinkedTimelines[0];
      const lastTimeline = currentLinkedTimelines[currentLinkedTimelines.length - 1];
      const currentBeforeToken = firstTimeline?.getPaginationToken(Direction.Backward);
      const roomCachePersistenceState = await loadRoomCachePersistenceState({
        sessionId,
        roomId: room.roomId,
        earliestLoadedEventId: earliestLoadedEvent?.getId(),
        currentBeforeToken,
      });

      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      if (firstTimeline && roomCachePersistenceState.shouldClearBackwardToken) {
        firstTimeline.setPaginationToken(null, Direction.Backward);
        setTimeline((currentTimeline) =>
          currentTimeline.linkedTimelines === currentLinkedTimelines
            ? { ...currentTimeline }
            : currentTimeline
        );
      }

      persistRoomEventCache(cacheEvents, roomCachePersistenceState.beforeTokenForEarliest);
      persistThreadCacheFromRoomEvents(threadCacheEvents, {
        roomStartKnown: roomCachePersistenceState.roomStartKnown,
        roomTailLoaded: !lastTimeline?.getPaginationToken(Direction.Forward),
      });
    };

    persistCurrentRoomCache();

    return () => {
      cancelled = true;
    };
  }, [
    alive,
    eventId,
    eventsLength,
    persistRoomEventCache,
    persistThreadCacheFromRoomEvents,
    room,
    roomIdRef,
    sessionId,
    setTimeline,
    threadId,
    threadIdRef,
    timeline.linkedTimelines,
  ]);

  useEffect(() => {
    if (threadId) {
      setRoomHasMoreCachedBack(false);
      return undefined;
    }

    let cancelled = false;
    const refreshRoomCachedBackState = async () => {
      const currentLinkedTimelines = timeline.linkedTimelines;
      const earliestLoadedEvent = getEarliestLoadedRoomEvent(room, currentLinkedTimelines);
      const cachedBackState = await loadRoomCachedBackStateSnapshot({
        sessionId,
        roomId: room.roomId,
        earliestLoadedEvent,
      });
      if (cancelled || !alive() || roomIdRef.current !== room.roomId || threadIdRef.current) return;

      const firstTimeline = currentLinkedTimelines[0];
      if (firstTimeline && cachedBackState.cachedBeforeToken === null) {
        const currentBeforeToken = firstTimeline.getPaginationToken(Direction.Backward);
        if (currentBeforeToken !== null) {
          firstTimeline.setPaginationToken(null, Direction.Backward);
          setTimeline((currentTimeline) =>
            currentTimeline.linkedTimelines === currentLinkedTimelines
              ? { ...currentTimeline }
              : currentTimeline
          );
        }
      }

      setRoomHasMoreCachedBack(cachedBackState.hasCachedBack);
    };

    refreshRoomCachedBackState();
    return () => {
      cancelled = true;
    };
  }, [
    alive,
    eventId,
    eventsLength,
    room,
    roomIdRef,
    sessionId,
    setRoomHasMoreCachedBack,
    setTimeline,
    threadId,
    threadIdRef,
    timeline.linkedTimelines,
  ]);

  return { persistRoomEventCache };
};
