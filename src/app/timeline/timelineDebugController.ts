import { useEffect, useRef } from 'react';
import type { Room } from 'matrix-js-sdk';
import { createTimelineDebugTrace, logTimelineDebug } from '../diagnostics/timelineDebug';

type TimelineDebugTraceIds = {
  roomDebugTraceId: string;
  threadDebugTraceId: string | undefined;
};

export const useTimelineDebugTraceIds = ({
  eventId,
  room,
  threadId,
}: {
  eventId: string | undefined;
  room: Room;
  threadId: string | undefined;
}): TimelineDebugTraceIds => {
  const roomDebugTraceRef = useRef({
    roomId: room.roomId,
    traceId: createTimelineDebugTrace('room-open', room.roomId),
  });
  const currentThreadTraceKey = threadId ? `${room.roomId}|${threadId}` : undefined;
  const threadDebugTraceRef = useRef<{ traceId?: string; traceKey?: string }>({
    traceId: currentThreadTraceKey
      ? createTimelineDebugTrace('thread-open', room.roomId, threadId)
      : undefined,
    traceKey: currentThreadTraceKey,
  });

  if (roomDebugTraceRef.current.roomId !== room.roomId) {
    roomDebugTraceRef.current = {
      roomId: room.roomId,
      traceId: createTimelineDebugTrace('room-open', room.roomId),
    };
  }
  if (threadDebugTraceRef.current.traceKey !== currentThreadTraceKey) {
    threadDebugTraceRef.current = {
      traceId: currentThreadTraceKey
        ? createTimelineDebugTrace('thread-open', room.roomId, threadId)
        : undefined,
      traceKey: currentThreadTraceKey,
    };
  }

  const roomDebugTraceId = roomDebugTraceRef.current.traceId;
  const threadDebugTraceId = threadDebugTraceRef.current.traceId;

  useEffect(() => {
    logTimelineDebug(roomDebugTraceId, 'init', {
      eventId,
      roomId: room.roomId,
      threadId,
    });
  }, [eventId, room.roomId, roomDebugTraceId, threadId]);

  useEffect(() => {
    if (!threadId) return;
    logTimelineDebug(threadDebugTraceId, 'init', {
      eventId,
      roomId: room.roomId,
      threadId,
    });
  }, [eventId, room.roomId, threadDebugTraceId, threadId]);

  return { roomDebugTraceId, threadDebugTraceId };
};
