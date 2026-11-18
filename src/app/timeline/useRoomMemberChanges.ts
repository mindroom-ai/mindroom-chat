import { useEffect, useReducer } from 'react';
import {
  EventType,
  RoomEvent,
  RoomMemberEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomMember,
} from 'matrix-js-sdk';

/**
 * Counts what changes the members a message row names: a member's new name or membership, and a
 * member event the room's timeline takes (a new avatar comes as one). The rows read names and
 * avatars from the room as they render, and nothing else tells an open thread of them. The sync
 * repeats member events that change nothing as state; those do not count.
 */
export const useRoomMemberChanges = (mx: MatrixClient, room: Room): number => {
  const [changes, count] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const onMember = (_event: MatrixEvent, member: RoomMember) => {
      if (member.roomId === room.roomId) count();
    };
    const onTimeline = (event: MatrixEvent) => {
      if (event.getType() === (EventType.RoomMember as string)) count();
    };
    mx.on(RoomMemberEvent.Name, onMember);
    mx.on(RoomMemberEvent.Membership, onMember);
    room.on(RoomEvent.Timeline, onTimeline);
    return () => {
      mx.removeListener(RoomMemberEvent.Name, onMember);
      mx.removeListener(RoomMemberEvent.Membership, onMember);
      room.removeListener(RoomEvent.Timeline, onTimeline);
    };
  }, [mx, room]);
  return changes;
};
