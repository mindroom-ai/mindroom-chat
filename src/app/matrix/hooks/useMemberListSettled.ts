import { useEffect, useState } from 'react';
import type { Room } from 'matrix-js-sdk';

/**
 * Whether the room's member list has loaded or failed to load; with lazy-loaded members it starts
 * loading the list. True for a room the client does not know, which has nothing to load.
 */
export const useMemberListSettled = (room: Room | null): boolean => {
  const [settledRoom, setSettledRoom] = useState<Room>();
  useEffect(() => {
    if (!room || room.membersLoaded()) return undefined;
    let disposed = false;
    const settle = () => {
      if (!disposed) setSettledRoom(room);
    };
    room.loadMembersIfNeeded().then(settle, settle);
    return () => {
      disposed = true;
    };
  }, [room]);
  return !room || room.membersLoaded() || settledRoom === room;
};
