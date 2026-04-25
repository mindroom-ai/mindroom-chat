import { useCallback, useRef, type MutableRefObject } from 'react';
import { type MatrixEvent, type Room } from 'matrix-js-sdk';
import { logTimelineDebug } from './timelineDebug';
import {
  persistThreadCacheFromRoomEventsSnapshot,
  persistThreadEventCacheSnapshot,
} from './eventRepository';

export type PersistThreadEventCache = (
  expectedThreadId: string,
  events: MatrixEvent[],
  rootEvent?: MatrixEvent | null,
  beforeTokenForEarliest?: string | null,
  tailLoaded?: boolean,
  snapshotComplete?: boolean,
  expectedReplyCount?: number,
  relationSnapshotComplete?: boolean
) => void;

export type ThreadCachePersistenceController = {
  persistThreadCacheFromRoomEvents: (
    events: MatrixEvent[],
    opts?: {
      beforeTokenForEarliest?: string | null;
      roomStartKnown?: boolean;
      roomTailLoaded?: boolean;
      snapshotComplete?: boolean;
      tailLoaded?: boolean;
    }
  ) => void;
  persistThreadEventCache: PersistThreadEventCache;
  queueRoomThreadCachePersist: (mEvent: MatrixEvent) => void;
};

export const useThreadCachePersistenceController = ({
  alive,
  room,
  roomDebugTraceId,
  roomIdRef,
  sessionId,
  threadDebugTraceId,
  threadIdRef,
}: {
  alive: () => boolean;
  room: Room;
  roomDebugTraceId: string;
  roomIdRef: MutableRefObject<string>;
  sessionId: string;
  threadDebugTraceId: string | undefined;
  threadIdRef: MutableRefObject<string | undefined>;
}): ThreadCachePersistenceController => {
  const persistThreadEventCache = useCallback<PersistThreadEventCache>(
    (
      expectedThreadId,
      events,
      rootEvent,
      beforeTokenForEarliest,
      tailLoaded,
      snapshotComplete,
      expectedReplyCount,
      relationSnapshotComplete
    ) => {
      const snapshot = persistThreadEventCacheSnapshot({
        sessionId,
        room,
        threadId: expectedThreadId,
        events,
        rootEvent,
        beforeTokenForEarliest,
        tailLoaded,
        snapshotComplete,
        expectedReplyCount,
        relationSnapshotComplete,
      });
      logTimelineDebug(threadDebugTraceId, 'thread-cache-persist', {
        beforeTokenForEarliest: beforeTokenForEarliest ?? null,
        cacheEventCount: snapshot.rawEvents.length,
        expectedReplyCount: snapshot.expectedReplyCount ?? null,
        loadedReplyCount: snapshot.loadedReplyCount,
        rawEventCount: snapshot.rawEvents.length,
        relationSnapshotComplete: relationSnapshotComplete === true,
        rootPresent: !!rootEvent,
        snapshotComplete: snapshotComplete === true,
        tailLoaded: tailLoaded === true,
        threadId: expectedThreadId,
      });
    },
    [room, sessionId, threadDebugTraceId]
  );

  const persistThreadCacheFromRoomEvents = useCallback(
    (
      events: MatrixEvent[],
      opts?: {
        beforeTokenForEarliest?: string | null;
        roomStartKnown?: boolean;
        roomTailLoaded?: boolean;
        snapshotComplete?: boolean;
        tailLoaded?: boolean;
      }
    ) => {
      const writes = persistThreadCacheFromRoomEventsSnapshot({
        sessionId,
        room,
        events,
        opts,
      });

      writes.forEach(
        ({
          threadId: expectedThreadId,
          rootEvent,
          nextSeedEvents,
          roomDerivedSnapshot,
          cacheSnapshot,
        }) => {
          if (roomDerivedSnapshot) {
            logTimelineDebug(roomDebugTraceId, 'room-thread-cache-room-snapshot', {
              beforeTokenForEarliest: roomDerivedSnapshot.beforeTokenForEarliest ?? null,
              expectedReplyCount: roomDerivedSnapshot.expectedReplyCount ?? null,
              loadedReplyCount: roomDerivedSnapshot.loadedReplyCount,
              seedCount: nextSeedEvents.length,
              snapshotComplete: roomDerivedSnapshot.snapshotComplete,
              tailLoaded: roomDerivedSnapshot.tailLoaded,
              threadId: expectedThreadId,
            });
          }

          logTimelineDebug(threadDebugTraceId, 'thread-cache-persist', {
            beforeTokenForEarliest: cacheSnapshot.beforeTokenForEarliest ?? null,
            cacheEventCount: cacheSnapshot.rawEvents.length,
            expectedReplyCount: cacheSnapshot.expectedReplyCount ?? null,
            loadedReplyCount: cacheSnapshot.loadedReplyCount,
            rawEventCount: cacheSnapshot.rawEvents.length,
            relationSnapshotComplete: cacheSnapshot.relationSnapshotComplete === true,
            rootPresent: !!rootEvent,
            snapshotComplete: cacheSnapshot.snapshotComplete === true,
            tailLoaded: cacheSnapshot.tailLoaded === true,
            threadId: expectedThreadId,
          });
        }
      );
    },
    [room, roomDebugTraceId, sessionId, threadDebugTraceId]
  );

  const pendingRoomThreadCacheEventsRef = useRef<MatrixEvent[]>([]);
  const roomThreadCacheFlushQueuedRef = useRef(false);
  const queueRoomThreadCachePersist = useCallback(
    (mEvent: MatrixEvent) => {
      pendingRoomThreadCacheEventsRef.current.push(mEvent);
      if (roomThreadCacheFlushQueuedRef.current) return;
      roomThreadCacheFlushQueuedRef.current = true;
      queueMicrotask(() => {
        roomThreadCacheFlushQueuedRef.current = false;
        const queuedEvents = pendingRoomThreadCacheEventsRef.current;
        pendingRoomThreadCacheEventsRef.current = [];
        if (
          queuedEvents.length === 0 ||
          !alive() ||
          roomIdRef.current !== room.roomId ||
          threadIdRef.current
        ) {
          return;
        }
        persistThreadCacheFromRoomEvents(queuedEvents);
      });
    },
    [alive, persistThreadCacheFromRoomEvents, room.roomId, roomIdRef, threadIdRef]
  );

  return {
    persistThreadCacheFromRoomEvents,
    persistThreadEventCache,
    queueRoomThreadCachePersist,
  };
};
