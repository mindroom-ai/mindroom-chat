import { useEffect, useState } from 'react';
import {
  EventTimeline,
  RoomEvent,
  RoomStateEvent,
  type MatrixEvent,
  type Room,
  type RoomStateEventHandlerMap,
} from 'matrix-js-sdk';

type StateSnapshot = {
  room: Room;
  eventType: string;
  events: MatrixEvent[];
};

/** The current state events of `eventType`, one per state key; empty when there are none. */
const takeSnapshot = (room: Room, eventType: string): StateSnapshot => ({
  room,
  eventType,
  events: room.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getStateEvents(eventType) ?? [],
});

/**
 * The room's current state events of `eventType`, read again whenever one of them changes. The
 * array keeps its identity between changes, so callers can key memos and caches on it.
 */
export const useStateEvents = (room: Room, eventType: string): MatrixEvent[] => {
  const [stored, setStored] = useState(() => takeSnapshot(room, eventType));

  // Switching rooms or types reads the new state during render instead of showing the old one.
  const stale = stored.room !== room || stored.eventType !== eventType;
  const snapshot = stale ? takeSnapshot(room, eventType) : stored;
  if (stale) setStored(snapshot);

  useEffect(() => {
    const refresh = () => setStored(takeSnapshot(room, eventType));
    const handleStateEvent: RoomStateEventHandlerMap[RoomStateEvent.Events] = (event) => {
      if (event.getRoomId() !== room.roomId || event.getType() !== eventType) return;
      refresh();
    };
    room.on(RoomStateEvent.Events, handleStateEvent);
    // A limited sync replaces the live timeline and with it the current state.
    room.on(RoomEvent.TimelineReset, refresh);
    return () => {
      room.removeListener(RoomStateEvent.Events, handleStateEvent);
      room.removeListener(RoomEvent.TimelineReset, refresh);
    };
  }, [room, eventType]);

  return snapshot.events;
};
