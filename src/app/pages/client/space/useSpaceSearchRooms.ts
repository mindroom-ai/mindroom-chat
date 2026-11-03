import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { mDirectAtom } from '../../../state/mDirectList';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { isMindroomEmojiRoom, isSpace } from '../../../utils/room';

type RoomToParents = Map<string, Set<string>>;

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

/** Whether `roomId` sits inside `spaceId`, directly or through nested spaces. */
const isInsideSpace = (roomId: string, spaceId: string, roomToParents: RoomToParents): boolean => {
  const visited = new Set<string>();
  const queue = [roomId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const parents = roomToParents.get(current);
    if (parents) {
      for (const parent of parents) {
        if (parent === spaceId) return true;
        if (!visited.has(parent)) {
          visited.add(parent);
          queue.push(parent);
        }
      }
    }
  }
  return false;
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
    if (!isInsideSpace(roomId, spaceId, roomToParents)) return false;
    const room = mx.getRoom(roomId);
    return !isSpace(room) && !isMindroomEmojiRoom(room);
  });

/** Parents the SDK knows from each space's `m.space.child` state. */
const getSdkRoomToParents = (mx: MatrixClient): RoomToParents => {
  const map: RoomToParents = new Map();
  mx.getRooms().forEach((room) => {
    if (!room.isSpaceRoom()) return;
    room.currentState.getStateEvents('m.space.child').forEach((event) => {
      const childId = event.getStateKey();
      const { via } = event.getContent();
      if (!childId || !Array.isArray(via) || via.length === 0) return;
      const parents = map.get(childId) ?? new Set<string>();
      parents.add(room.roomId);
      map.set(childId, parents);
    });
  });
  return map;
};

export const useSpaceSearchRooms = (spaceId: string): string[] => {




  return useMemo(() => {
    const sdkRooms = mx.getRooms().map((room) => room.roomId);
    return getSpaceSearchRooms(
      mx,
      spaceId,
      mergeSearchRoomSources(sdkRooms, rooms),
      directs,
      mergeRoomToParentsSources(roomToParents, getSdkRoomToParents(mx))
    );
  }, [mx, spaceId, rooms, directs, roomToParents]);
};
