import { useEffect, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { logger } from 'matrix-js-sdk/lib/logger';

/**
 * Loads the member lists of `roomIds`, for lists that name senders in rooms the user may not have
 * opened: with lazy-loaded members the client knows only the members whose events it has seen, so
 * a sender who has not posted lately would show as their user ID's localpart, and a member who
 * copied their name would read as them. Returns a number that changes whenever a list arrives, for
 * the memos that name senders to depend on.
 */
export const useLoadedRoomMembers = (mx: MatrixClient, roomIds: readonly string[]): number => {
  const [loads, setLoads] = useState(0);
  const key = [...new Set(roomIds)].sort().join(' ');

  useEffect(() => {
    let disposed = false;
    key
      .split(' ')
      .map((roomId) => mx.getRoom(roomId))
      .forEach((room) => {
        if (!room || room.membersLoaded()) return;
        room
          .loadMembersIfNeeded()
          .then(() => {
            if (!disposed) setLoads((count) => count + 1);
          })
          .catch((error: unknown) => {
            logger.warn('[useLoadedRoomMembers] Failed to load room members', error);
          });
      });
    return () => {
      disposed = true;
    };
  }, [key, mx]);

  return loads;
};
