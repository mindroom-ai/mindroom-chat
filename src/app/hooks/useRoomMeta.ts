import { useCallback, useEffect, useState } from 'react';
import { EventTimeline, JoinRule, MatrixEvent, Room, RoomEvent } from 'matrix-js-sdk';
import { StateEvent } from '../../types/matrix/room';
import { useStateEventCallback } from './useStateEventCallback';
import { useForceUpdate } from './useForceUpdate';

const readStateEvent = (room: Room, type: StateEvent): MatrixEvent | undefined =>
  room.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getStateEvents(type, '') ?? undefined;

/** Re-renders when `type` state changes in `room`. */
const useRoomStateVersion = (room: Room, type: StateEvent): number => {
  const [version, refresh] = useForceUpdate();



      (event: MatrixEvent) => {
        if (event.getRoomId() === room.roomId && event.getType() === type) refresh();
      },
      [room.roomId, type, refresh]
    )
  );










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

/** The room topic, following `m.room.topic` changes. */
export const useRoomTopic = (room: Room): string | undefined => {
  const version = useRoomStateVersion(room, StateEvent.RoomTopic);
  void version;
  const topic = readStateEvent(room, StateEvent.RoomTopic)?.getContent().topic;
  return typeof topic === 'string' && topic.trim().length > 0 ? topic : undefined;
};

/** The room's join rule, following `m.room.join_rules` changes. */
export const useRoomJoinRule = (room: Room): JoinRule | undefined => {
  const version = useRoomStateVersion(room, StateEvent.RoomJoinRules);
  void version;
  const joinRule = readStateEvent(room, StateEvent.RoomJoinRules)?.getContent().join_rule;
  return typeof joinRule === 'string' ? (joinRule as JoinRule) : undefined;
};
