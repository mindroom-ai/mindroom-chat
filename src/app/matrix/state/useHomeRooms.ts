import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import type { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { allRoomsAtom } from './roomList';
import { mDirectAtom } from './mDirectList';
import { roomToParentsAtom } from './roomToParents';
import { navigationRoomsAtom } from './archivedRooms';
import { isEmojiRoom, isSpace } from '../room';
import type { RoomToParents } from '../types/room';
import { mergeSearchRoomSources } from './useSpaceSearchRooms';
import { getAncestorSpaceIds } from './spaceAncestors';

/** Joins room ID lists in order, keeping the first occurrence of each ID. */
export const mergeHomeSearchRoomSources = mergeSearchRoomSources;

const isHomeRoom = (
  client: MatrixClient,
  roomId: string,
  directRoomIds: Set<string>,
  roomToParents: RoomToParents
): boolean => {
  if (directRoomIds.has(roomId)) return false;
  // Inside a space at any depth, through the chat rooms a sub-room sits under too.
  if (getAncestorSpaceIds(roomToParents, roomId).some((id) => isSpace(client.getRoom(id)))) {
    return false;
  }
  const room = client.getRoom(roomId);
  return !isSpace(room) && !isEmojiRoom(room);
};

/**
 * Rooms that Home lists and message search covers from Home: joined rooms
 * that are not direct messages, not spaces, not the server emoji room, and
 * not inside a space, sub-rooms of the other Home rooms included.
 */
export const getHomeSearchRooms = (
  client: MatrixClient,
  roomIds: string[],
  directRoomIds: Set<string>,
  roomToParents: RoomToParents
): string[] => roomIds.filter((roomId) => isHomeRoom(client, roomId, directRoomIds, roomToParents));

/** What both Home room lists are computed from: the joined rooms and how they are grouped. */
const useHomeRoomSources = () => {
  const client = useMatrixClient();
  const directRoomIds = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const rooms = useAtomValue(allRoomsAtom);
  return { client, rooms, directRoomIds, roomToParents };
};

/**
 * Room IDs shown under Rooms on Home, which the rail's Home button also counts and marks read:
 * the Home rooms the user has not archived.
 */
export const useHomeRooms = (): string[] => {
  const { client, directRoomIds, roomToParents } = useHomeRoomSources();
  const listed = useAtomValue(navigationRoomsAtom);
  return useMemo(
    () => getHomeSearchRooms(client, listed, directRoomIds, roomToParents),
    [client, listed, directRoomIds, roomToParents]
  );
};

/** Room IDs message search covers from Home: every Home room, including those the SDK knows but the list has not bound yet. */
export const useHomeSearchRooms = (): string[] => {
  const { client, rooms, directRoomIds, roomToParents } = useHomeRoomSources();
  return useMemo(() => {
    const sdkRooms = client.getRooms().map((room) => room.roomId);
    return getHomeSearchRooms(
      client,
      mergeHomeSearchRoomSources(rooms, sdkRooms),
      directRoomIds,
      roomToParents
    );
  }, [client, rooms, directRoomIds, roomToParents]);
};
