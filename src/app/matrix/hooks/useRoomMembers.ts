import { useEffect, useState } from 'react';
import {
  ClientEvent,
  MatrixClient,
  MatrixEvent,
  Room,
  RoomMember,
  RoomMemberEvent,
} from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';

const EMPTY_MEMBERS: RoomMember[] = [];

const knownMembers = (client: MatrixClient, roomId: string): RoomMember[] =>
  client.getRoom(roomId)?.getMembers() ?? EMPTY_MEMBERS;

/**
 * The members of a room, following membership, name and power changes. Starts with the members
 * the client already knows and loads the full list in the background (lazy-loaded rooms), once
 * the client knows the room. After a switch to another room, never the previous room's.
 */
export const useRoomMembers = (mx: MatrixClient, roomId: string): RoomMember[] => {
  const [members, setMembers] = useState(() => ({ roomId, list: knownMembers(mx, roomId) }));

  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      if (disposed) return;
      setMembers({ roomId, list: knownMembers(mx, roomId) });
    };
    const loadMembers = (room: Room | null) => {
      refresh();
      room
        ?.loadMembersIfNeeded()
        .then(refresh)
        .catch((error: unknown) => {
          logger.warn('[useRoomMembers] Failed to load room members', error);
        });
    };
    // A room the client learns of later (a join or invite by sync) is in the store when Room fires,
    // so refresh() reads its members.
    const handleRoom = (room: Room) => {
      if (room.roomId === roomId) loadMembers(room);
    };
    const handleMemberEvent = (event: MatrixEvent | undefined, member?: RoomMember) => {
      const eventRoomId = event?.getRoomId() ?? member?.roomId;
      if (eventRoomId === roomId) refresh();
    };

    loadMembers(mx.getRoom(roomId));

    mx.on(ClientEvent.Room, handleRoom);
    mx.on(RoomMemberEvent.Membership, handleMemberEvent);
    mx.on(RoomMemberEvent.Name, handleMemberEvent);
    mx.on(RoomMemberEvent.PowerLevel, handleMemberEvent);
    return () => {
      disposed = true;
      mx.removeListener(ClientEvent.Room, handleRoom);
      mx.removeListener(RoomMemberEvent.Membership, handleMemberEvent);
      mx.removeListener(RoomMemberEvent.Name, handleMemberEvent);
      mx.removeListener(RoomMemberEvent.PowerLevel, handleMemberEvent);
    };
  }, [mx, roomId]);

  // Until the effect reads the new room's members, the state holds the previous room's.
  return members.roomId === roomId ? members.list : knownMembers(mx, roomId);
};
