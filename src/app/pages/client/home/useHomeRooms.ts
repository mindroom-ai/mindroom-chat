import { useAtomValue } from 'jotai';
import { MatrixClient } from 'matrix-js-sdk';
import { useMemo } from 'react';
import { RoomToParents } from '../../../../types/matrix/room';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { mDirectAtom } from '../../../state/mDirectList';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { useOrphanRooms, useRooms } from '../../../state/hooks/roomList';
import { useSimpleMode } from '../../../mindroom/settings/useMindroomAccountSettings';
import { isRoom, isSpace } from '../../../utils/room';

export const useHomeRooms = () => {
  const mx = useMatrixClient();
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  // Simple mode hides the spaces sidebar, so Home flattens every joined room
  // into one list — rooms organized into spaces must not become unreachable.
  const simpleMode = useSimpleMode();
  const orphanRooms = useOrphanRooms(mx, allRoomsAtom, mDirects, roomToParents);
  const flatRooms = useRooms(mx, allRoomsAtom, mDirects);
  return simpleMode ? flatRooms : orphanRooms;
};

/** All non-direct rooms and spaces used by Home's unified navigation tree. */
export const getHomeNavigationRooms = (
  mx: MatrixClient,
  allRoomIds: string[],
  mDirects: Set<string>
): { roomIds: string[]; spaceIds: string[] } => ({
  roomIds: allRoomIds.filter((roomId) => !mDirects.has(roomId) && isRoom(mx.getRoom(roomId))),
  spaceIds: allRoomIds.filter((roomId) => isSpace(mx.getRoom(roomId))),
});

export const useHomeNavigationRooms = () => {
  const mx = useMatrixClient();
  const mDirects = useAtomValue(mDirectAtom);
  const allRoomIds = useAtomValue(allRoomsAtom);
  return useMemo(
    () => getHomeNavigationRooms(mx, allRoomIds, mDirects),
    [allRoomIds, mDirects, mx]
  );
};

export const getHomeSearchRooms = (
  mx: MatrixClient,
  allRooms: string[],
  mDirects: Set<string>,
  roomToParents: RoomToParents,
  includeSpaceChildren = false
): string[] =>
  allRooms.filter(
    (roomId) =>
      !mDirects.has(roomId) &&
      (includeSpaceChildren || !roomToParents.has(roomId)) &&
      !isSpace(mx.getRoom(roomId))
  );

export const mergeHomeSearchRoomSources = (sdkRoomIds: string[], allRoomIds: string[]): string[] =>
  Array.from(new Set([...sdkRoomIds, ...allRoomIds]));

export const useHomeSearchRooms = () => {
  const mx = useMatrixClient();
  const allRooms = useAtomValue(allRoomsAtom);
  const mDirects = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const simpleMode = useSimpleMode();
  const sdkRoomIdsKey = mx
    .getRooms()
    .map((room) => room.roomId)
    .join('\n');

  return useMemo(() => {
    const sdkRoomIds = sdkRoomIdsKey ? sdkRoomIdsKey.split('\n') : [];
    return getHomeSearchRooms(
      mx,
      mergeHomeSearchRoomSources(sdkRoomIds, allRooms),
      mDirects,
      roomToParents,
      simpleMode
    );
  }, [allRooms, mDirects, mx, roomToParents, sdkRoomIdsKey, simpleMode]);
};
