import { useEffect, useState } from 'react';
import { MatrixClient, MatrixEvent, RoomMember, RoomMemberEvent } from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';

const EMPTY_MEMBERS: RoomMember[] = [];

const knownMembers = (client: MatrixClient, roomId: string): RoomMember[] =>
  client.getRoom(roomId)?.getMembers() ?? EMPTY_MEMBERS;

/**
 * The members of a room, following membership, name and power changes. Starts with the members
 * the client already knows and loads the full list in the background (lazy-loaded rooms).
 */
export const useRoomMembers = (mx: MatrixClient, roomId: string): RoomMember[] => {
  const [members, setMembers] = useState(() => knownMembers(mx, roomId));

  useEffect(() => {
    let disposed = false;
    const room = mx.getRoom(roomId);
    const refresh = () => {
      if (disposed) return;
      setMembers(knownMembers(mx, roomId));
    };
    const handleMemberEvent = (event: MatrixEvent | undefined, member?: RoomMember) => {
      const eventRoomId = event?.getRoomId() ?? member?.roomId;
      if (eventRoomId === roomId) refresh();
    };

    refresh();
    room
      ?.loadMembersIfNeeded()
      .then(refresh)
      .catch((error: unknown) => {
        logger.warn('[useRoomMembers] Failed to load room members', error);
      });

    mx.on(RoomMemberEvent.Membership, handleMemberEvent);
    mx.on(RoomMemberEvent.Name, handleMemberEvent);
    mx.on(RoomMemberEvent.PowerLevel, handleMemberEvent);
    return () => {
      disposed = true;
      mx.removeListener(RoomMemberEvent.Membership, handleMemberEvent);
      mx.removeListener(RoomMemberEvent.Name, handleMemberEvent);
      mx.removeListener(RoomMemberEvent.PowerLevel, handleMemberEvent);
    };
  }, [mx, roomId]);

  return members;
};
