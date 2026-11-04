import { useEffect, useMemo, useState } from 'react';
import { MatrixEvent, Room, RoomStateEvent } from 'matrix-js-sdk';
import { StateEvent } from '../../types/matrix/room';
import { matchesEnum } from '../utils/matchesEnum';

/** Room state by event type, then by state key. */
export type StateTypeToState = Map<string, Map<string, MatrixEvent>>;

const readRoomState = (room: Room): StateTypeToState => {
  const state: StateTypeToState = new Map();
  room.currentState.events.forEach((byStateKey, type) => {
    if (matchesEnum(type, StateEvent.RoomMember)) return;
    state.set(type, new Map(byStateKey));
  });
  return state;
};

/**
 * The room's current state, without membership. Member events arrive with every sync batch and
 * would re-render callers that only care about room settings, so they do not count as changes.
 */
export const useRoomState = (room: Room): StateTypeToState => {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handleEvent = (event: MatrixEvent) => {
      if (event.getRoomId() !== room.roomId) return;
      if (matchesEnum(event.getType(), StateEvent.RoomMember)) return;
      setVersion((current) => current + 1);
    };
    room.on(RoomStateEvent.Events, handleEvent);
    return () => {
      room.removeListener(RoomStateEvent.Events, handleEvent);
    };
  }, [room]);

  return useMemo(() => {
    void version;
    return readRoomState(room);
  }, [room, version]);
};
