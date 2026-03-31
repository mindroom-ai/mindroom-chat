import { useAtomValue } from 'jotai';
import { MatrixClient } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { RoomToParents } from '../../../../types/matrix/room';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { mDirectAtom } from '../../../state/mDirectList';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { useOrphanRooms } from '../../../state/hooks/roomList';
import { isSpace } from '../../../utils/room';

export const useHomeRooms = () => {
  const mx = useMatrixClient();
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const rooms = useOrphanRooms(mx, allRoomsAtom, mDirects, roomToParents);
  return rooms;
};

export const getHomeSearchRooms = (
  mx: MatrixClient,
  allRooms: string[],
  mDirects: Set<string>,
  roomToParents: RoomToParents
): string[] =>
  allRooms.filter(
    (roomId) => !mDirects.has(roomId) && !roomToParents.has(roomId) && !isSpace(mx.getRoom(roomId))
  );

export const mergeHomeSearchRoomSources = (
  sdkRoomIds: string[],
  allRoomIds: string[]
): string[] => Array.from(new Set([...sdkRoomIds, ...allRoomIds]));

export const useHomeSearchRooms = () => {
  const mx = useMatrixClient();
  const allRooms = useAtomValue(allRoomsAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const sdkRoomIds = mx.getRooms().map((room) => room.roomId);
  const sdkRoomIdsKey = sdkRoomIds.join('\n');

  return useMemo(
    () =>
      getHomeSearchRooms(
        mx,
        mergeHomeSearchRoomSources(sdkRoomIds, allRooms),
        mDirects,
        roomToParents
      ),
    [allRooms, mDirects, mx, roomToParents, sdkRoomIdsKey]
  );
};
