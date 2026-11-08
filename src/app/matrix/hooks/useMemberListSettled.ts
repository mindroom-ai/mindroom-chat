import { useEffect, useState } from 'react';
import type { Room } from 'matrix-js-sdk';

/**
 * Whether the room's member list has loaded, or failed to, which with lazy-loaded members it starts
 * loading. A room the client does not know has nothing to load.
 */
export const useMemberListSettled = (room: Room | null): boolean => {
  const [settled, setSettled] = useState<Room>();
  useEffect(() => {
    if (!room || room.membersLoaded()) return undefined;
    let disposed = false;
    const settle = () => {
      if (!disposed) setSettled(room);
    };
    room.loadMembersIfNeeded().then(settle, settle);
    return () => {
      disposed = true;
    };
  }, [room]);
  return !room || room.membersLoaded() || settled === room;
};
