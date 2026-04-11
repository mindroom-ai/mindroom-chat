import { useEffect, useState } from 'react';
import { Room, RoomEvent, RoomEventHandlerMap, ThreadEvent } from 'matrix-js-sdk';
import { resolveCanonicalThreadRootId } from './threadRouteUtils';

/**
 * Resolve the canonical thread root event ID from a threadId.
 *
 * The threadId passed via URL may be a reply event ID rather than the actual
 * thread root. This hook resolves to the canonical root by checking the SDK
 * thread model and event metadata.
 *
 * Returns undefined only when threadId is undefined.
 * When threadId is defined, always returns a string (falls back to threadId itself).
 */
export const useThreadRootEvent = (
  room: Room,
  threadId: string | undefined
): string | undefined => {
  const [rootId, setRootId] = useState<string | undefined>(() =>
    resolveCanonicalThreadRootId(room, threadId)
  );

  useEffect(() => {
    setRootId(resolveCanonicalThreadRootId(room, threadId));
  }, [room, threadId]);

  useEffect(() => {
    if (!threadId) return undefined;

    const refreshRootId = () => {
      const nextRootId = resolveCanonicalThreadRootId(room, threadId);
      setRootId((currentRootId) => (currentRootId === nextRootId ? currentRootId : nextRootId));
    };

    const handleTimeline: RoomEventHandlerMap[RoomEvent.Timeline] = (
      _event,
      eventRoom,
      _toStartOfTimeline,
      removed
    ) => {
      if (removed || eventRoom?.roomId !== room.roomId) return;
      refreshRootId();
    };
    const handleLocalEcho: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (
      event,
      eventRoom,
      oldEventId
    ) => {
      if (eventRoom?.roomId !== room.roomId) return;
      if (oldEventId && oldEventId !== threadId) return;

      const canonicalEventId = event.getId();
      const nextRootId =
        resolveCanonicalThreadRootId(room, canonicalEventId ?? undefined) ??
        canonicalEventId ??
        threadId;
      setRootId((currentRootId) => (currentRootId === nextRootId ? currentRootId : nextRootId));
    };

    room.on(RoomEvent.Timeline, handleTimeline);
    room.on(RoomEvent.LocalEchoUpdated, handleLocalEcho);
    room.on(ThreadEvent.New, refreshRootId);
    room.on(ThreadEvent.Update, refreshRootId);
    room.on(ThreadEvent.NewReply, refreshRootId);
    room.on(ThreadEvent.Delete, refreshRootId);

    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimeline);
      room.removeListener(RoomEvent.LocalEchoUpdated, handleLocalEcho);
      room.removeListener(ThreadEvent.New, refreshRootId);
      room.removeListener(ThreadEvent.Update, refreshRootId);
      room.removeListener(ThreadEvent.NewReply, refreshRootId);
      room.removeListener(ThreadEvent.Delete, refreshRootId);
    };
  }, [room, threadId]);

  return rootId;
};
