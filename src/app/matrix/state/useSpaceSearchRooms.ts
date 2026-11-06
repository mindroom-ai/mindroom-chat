import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { allRoomsAtom } from './roomList';
import { mDirectAtom } from './mDirectList';
import { getSpaceChildIds, roomToParentsAtom } from './roomToParents';
import { isInSpace } from './spaceAncestors';
import type { RoomToParents } from '../types/room';
import { isEmojiRoom, isSpace } from '../room';

/** Joins room ID lists in order, keeping the first occurrence of each ID. */
export const mergeSearchRoomSources = (...sources: string[][]): string[] =>
  Array.from(new Set(sources.flat()));

/** Unions the parents each source knows for every room. */
export const mergeRoomToParentsSources = (...sources: RoomToParents[]): RoomToParents => {
  const merged: RoomToParents = new Map();
  sources.forEach((source) => {
    source.forEach((parents, roomId) => {
      const target = merged.get(roomId) ?? new Set<string>();
      parents.forEach((parent) => target.add(parent));
      merged.set(roomId, target);
    });
  });
  return merged;
};

/** Rooms message search covers inside a space: its rooms at any depth, without DMs or subspaces. */
export const getSpaceSearchRooms = (
  mx: MatrixClient,
  spaceId: string,
  roomIds: string[],
  directs: Set<string>,
  roomToParents: RoomToParents
): string[] =>
  roomIds.filter((roomId) => {
    if (roomId === spaceId || directs.has(roomId)) return false;
    if (!isInSpace(roomToParents, roomId, spaceId)) return false;
    const room = mx.getRoom(roomId);
    return !isSpace(room) && !isEmojiRoom(room);
  });

/** Parents the SDK knows from each space's `m.space.child` state. */
const getSdkRoomToParents = (mx: MatrixClient): RoomToParents => {
  const map: RoomToParents = new Map();
  mx.getRooms().forEach((room) => {
    if (!room.isSpaceRoom()) return;
    getSpaceChildIds(room).forEach((childId) => {
      const parents = map.get(childId) ?? new Set<string>();
      parents.add(room.roomId);
      map.set(childId, parents);
    });
  });
  return map;
};

export const useSpaceSearchRooms = (spaceId: string): string[] => {
  const client = useMatrixClient();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const directRoomIds = useAtomValue(mDirectAtom);
  const parentsByRoom = useAtomValue(roomToParentsAtom);
  return useMemo(() => {
    const sdkRoomIds = client.getRooms().map((room) => room.roomId);
    return getSpaceSearchRooms(
      client,
      spaceId,
      mergeSearchRoomSources(sdkRoomIds, joinedRoomIds),
      directRoomIds,
      mergeRoomToParentsSources(parentsByRoom, getSdkRoomToParents(client))
    );
  }, [client, spaceId, joinedRoomIds, directRoomIds, parentsByRoom]);
};

/**
 * The rooms a space's navigation lists: the joined rooms inside it at any depth, without DMs or
 * subspaces. Search also covers rooms the client only knows of (invited, or left and still in
 * the store), which the navigation would show as rooms the user is in.
 */
export const useSpaceNavigationRooms = (spaceId: string): string[] => {
  const client = useMatrixClient();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const directRoomIds = useAtomValue(mDirectAtom);
  const parentsByRoom = useAtomValue(roomToParentsAtom);
  return useMemo(
    () => getSpaceSearchRooms(client, spaceId, joinedRoomIds, directRoomIds, parentsByRoom),
    [client, spaceId, joinedRoomIds, directRoomIds, parentsByRoom]
  );
};

/**
 * A space's own room list: the joined rooms it lists directly, without DMs or sub-spaces. Rooms
 * of a sub-space show in the sub-space's own list.
 */
export const getSpaceOwnRooms = (
  mx: MatrixClient,
  spaceId: string,
  roomIds: string[],
  directs: Set<string>,
  roomToParents: RoomToParents
): string[] =>
  roomIds.filter((roomId) => {
    if (directs.has(roomId) || !roomToParents.get(roomId)?.has(spaceId)) return false;
    const room = mx.getRoom(roomId);
    return !isSpace(room) && !isEmojiRoom(room);
  });

/** The joined spaces a space lists directly. */
export const getJoinedSubspaces = (
  mx: MatrixClient,
  spaceId: string,
  roomIds: string[],
  roomToParents: RoomToParents
): string[] =>
  roomIds.filter(
    (roomId) => roomToParents.get(roomId)?.has(spaceId) === true && isSpace(mx.getRoom(roomId))
  );

export const useSpaceOwnRooms = (spaceId: string): string[] => {
  const client = useMatrixClient();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const directRoomIds = useAtomValue(mDirectAtom);
  const parentsByRoom = useAtomValue(roomToParentsAtom);
  return useMemo(
    () => getSpaceOwnRooms(client, spaceId, joinedRoomIds, directRoomIds, parentsByRoom),
    [client, spaceId, joinedRoomIds, directRoomIds, parentsByRoom]
  );
};

export const useJoinedSubspaces = (spaceId: string): string[] => {
  const client = useMatrixClient();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const parentsByRoom = useAtomValue(roomToParentsAtom);
  return useMemo(
    () => getJoinedSubspaces(client, spaceId, joinedRoomIds, parentsByRoom),
    [client, spaceId, joinedRoomIds, parentsByRoom]
  );
};

/** The joined spaces that list `spaceId` directly. */
export const useJoinedParentSpaces = (spaceId: string): string[] => {
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const parentsByRoom = useAtomValue(roomToParentsAtom);
  return useMemo(() => {
    const parents = parentsByRoom.get(spaceId);
    return parents ? joinedRoomIds.filter((roomId) => parents.has(roomId)) : [];
  }, [spaceId, joinedRoomIds, parentsByRoom]);
};
