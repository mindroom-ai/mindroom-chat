import { useEffect, useState } from 'react';
import {
  EventTimeline,
  RoomEvent,
  RoomStateEvent,
  type MatrixEvent,
  type Room,
  type RoomStateEventHandlerMap,
} from 'matrix-js-sdk';

/** The current state events of `eventType`, one per state key; empty when there are none. */








  const [state, setState] = useState(() => ({
    room,
    eventType,
    events: readStateEvents(room, eventType),
  }));

  const stale = state.room !== room || state.eventType !== eventType;
  if (stale) {
    // Switching rooms or types reads the new state during render instead of showing the old one.
    setState({ room, eventType, events: readStateEvents(room, eventType) });
  }

  useEffect(() => {
    const refresh = () => setState({ room, eventType, events: readStateEvents(room, eventType) });
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

  return stale ? readStateEvents(room, eventType) : state.events;
};
