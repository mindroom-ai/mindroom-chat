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
export const mergeHomeSearchRoomSources = (...sources: string[][]): string[] =>
  Array.from(new Set(sources.flat()));

const isHomeRoom = (
  mx: MatrixClient,
  roomId: string,
  directs: Set<string>,
  roomToParents: RoomToParents
): boolean => {
  if (directs.has(roomId)) return false;
  if ((roomToParents.get(roomId)?.size ?? 0) > 0) return false;
  const room = mx.getRoom(roomId);
  return !isSpace(room) && !isMindroomEmojiRoom(room);
};

/**
 * Rooms that Home lists and message search covers from Home: joined rooms
 * that are not direct messages, not spaces, not the server emoji room, and
 * not inside a space.
 */
export const getHomeSearchRooms = (
  mx: MatrixClient,
  roomIds: string[],
  directs: Set<string>,
  roomToParents: RoomToParents
): string[] => roomIds.filter((roomId) => isHomeRoom(mx, roomId, directs, roomToParents));

/** Room IDs shown under Rooms on Home. */
export const useHomeRooms = (): string[] => {





    () => getHomeSearchRooms(mx, rooms, directs, roomToParents),
    [mx, rooms, directs, roomToParents]
  );
};

/** Room IDs message search covers from Home: every Home room, including those the SDK knows but the list has not bound yet. */
export const useHomeSearchRooms = (): string[] => {




  return useMemo(() => {
    const sdkRooms = mx.getRooms().map((room) => room.roomId);
    return getHomeSearchRooms(
      mx,
      mergeHomeSearchRoomSources(rooms, sdkRooms),
      directs,
      roomToParents
    );
  }, [mx, rooms, directs, roomToParents]);
};
