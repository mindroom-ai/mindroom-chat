import { useEffect, useReducer, useRef } from 'react';
import { EventStatus, RoomEvent, type Room, type RoomEventHandlerMap } from 'matrix-js-sdk';
import { isLocalEchoEventId } from '../event-store/threads/threadRouteUtils';

/**
 * The open thread's root while it is still a local echo: its event, when the room holds it.
 * Re-renders as the echo's send state changes, and reports a root that was deleted unsent.
 */
export const useLocalEchoRoot = (
  room: Room,
  threadId: string | undefined,
  onDeleted?: () => void
) => {
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const pending = isLocalEchoEventId(threadId);
  const latestOnDeleted = useRef(onDeleted);
  latestOnDeleted.current = onDeleted;

  useEffect(() => {
    if (!pending) return undefined;
    const onEcho: RoomEventHandlerMap[RoomEvent.LocalEchoUpdated] = (event, _room, oldId) => {
      if (oldId !== threadId && event.getId() !== threadId) return;
      if (event.status === EventStatus.CANCELLED) latestOnDeleted.current?.();
      else refresh();
    };
    room.on(RoomEvent.LocalEchoUpdated, onEcho);
    return () => {
      room.removeListener(RoomEvent.LocalEchoUpdated, onEcho);
    };
  }, [pending, room, threadId]);

  if (!pending || !threadId) return { pending: false as const };
  return { pending: true as const, event: room.findEventById(threadId) ?? undefined };
};
