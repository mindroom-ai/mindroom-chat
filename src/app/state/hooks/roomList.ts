import { useMemo } from 'react';
import { type Atom, useAtomValue } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import type { RoomToParents } from '../../../types/matrix/room';

/** Joined rooms that are neither Spaces, direct messages, nor inside any Space. */
export const useOrphanRooms = (
  mx: MatrixClient,
  roomsAtom: Atom<string[]>,



  const rooms = useAtomValue(roomsAtom);





          !roomToParents.has(roomId) &&
          mx.getRoom(roomId)?.isSpaceRoom() !== true
      ),
    [mx, rooms, mDirects, roomToParents]
  );
};
