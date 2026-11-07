import { useEffect, useReducer } from 'react';
import {
  RoomStateEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomMember,
  type RoomState,
} from 'matrix-js-sdk';
import { getMemberDisplayName } from '../room';

/**
 * `getMemberDisplayName` of `userId` in `room`, as soon as the room knows the member. A room that
 * loads its members lazily may not know them yet (an agent that has not spoken in what sync sent,
 * or any member after a start that has not opened the room): the members are then loaded, and the
 * name follows when they arrive.
 */
export const useMemberDisplayName = (
  client: MatrixClient,
  room: Room | null | undefined,
  userId: string
): string | undefined => {
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const name = room ? getMemberDisplayName(room, userId) : undefined;
  const known = name !== undefined;
  useEffect(() => {
    if (!room || known) return undefined;
    let active = true;
    const onMember = (_event: MatrixEvent, state: RoomState, member: RoomMember) => {
      if (state.roomId === room.roomId && member.userId === userId) refresh();
    };
    client.on(RoomStateEvent.Members, onMember);
    room
      .loadMembersIfNeeded()
      .then(() => {
        if (active) refresh();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      client.removeListener(RoomStateEvent.Members, onMember);
    };
  }, [client, room, userId, known]);
  return name;
};
