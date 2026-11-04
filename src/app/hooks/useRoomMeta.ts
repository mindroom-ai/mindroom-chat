import { useCallback, useEffect, useState } from 'react';
import { EventTimeline, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { StateEvent } from '../../types/matrix/room';
import { matchesEnum } from '../utils/matchesEnum';
import { useStateEventCallback } from './useStateEventCallback';
import { useForceUpdate } from './useForceUpdate';
import { useStateEvent } from './useStateEvent';

const readStateEvent = (room: Room, type: StateEvent): MatrixEvent | undefined =>
  room.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getStateEvents(type, '') ?? undefined;

/** Re-renders when `type` state changes in `room`. */
const useRoomStateVersion = (room: Room, type: StateEvent): number => {
  const [version, refresh] = useForceUpdate();
  const onStateEvent = useCallback(
    (event: MatrixEvent) => {
      if (event.getRoomId() === room.roomId && matchesEnum(event.getType(), type)) refresh();
    },
    [room.roomId, type, refresh]
  );
  useStateEventCallback(room.client, onStateEvent);
  return version;
};

/** The room's display name as computed by matrix-js-sdk, updated on every `RoomEvent.Name`. */
export const useRoomName = (room: Room): string => {
  const [name, setName] = useState(() => room.name);

  useEffect(() => {
    const handleName = (renamed: Room) => setName(renamed.name);
    // The room may have been renamed between the first render and this subscription.
    setName(room.name);
    room.on(RoomEvent.Name, handleName);
    return () => {
      room.removeListener(RoomEvent.Name, handleName);
    };
  }, [room]);

  return name;
};

/**
 * The `mxc://` URL of the room avatar, following `m.room.avatar` changes. For a direct room it
 * is the other member's avatar instead.
 */
export const useRoomAvatar = (room: Room, dm?: boolean): string | undefined => {
  const version = useRoomStateVersion(room, StateEvent.RoomAvatar);
  void version;
  if (dm) return room.getAvatarFallbackMember()?.getMxcAvatarUrl() ?? undefined;
  const url = readStateEvent(room, StateEvent.RoomAvatar)?.getContent().url;
  return typeof url === 'string' && url.length > 0 ? url : undefined;
};

/** The text of the room's `m.room.topic`, kept current; undefined for a missing or blank topic. */
export function useRoomTopic(room: Room): string | undefined {
  const text: unknown = useStateEvent(room, StateEvent.RoomTopic)?.getContent().topic;
  if (typeof text !== 'string' || text.trim() === '') return undefined;
  return text;
}
