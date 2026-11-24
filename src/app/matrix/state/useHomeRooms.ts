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

/** Joins room ID lists in order, keeping the first occurrence of each ID. */
export const mergeHomeSearchRoomSources = mergeSearchRoomSources;

/** Whether `roomId` is a regular chat room (not a DM, space, or server emoji room). */
export const isOrdinaryRoom = (
  client: MatrixClient,
  roomId: string,
  directRoomIds: ReadonlySet<string>
): boolean => {
  if (directRoomIds.has(roomId)) return false;
  const room = client.getRoom(roomId);
  return !isSpace(room) && !isEmojiRoom(room);
};

/**
 * Whether `roomId` is enclosed by a currently joined space (directly or through chat-room
 * parents). Left spaces still cached in the SDK store do not enclose their rooms.
 */
const isEnclosedByJoinedSpace = (
  client: MatrixClient,
  roomId: string,
  roomToParents: RoomToParents,
  joinedRoomIds: ReadonlySet<string>
): boolean => {
  const visited = new Set<string>([roomId]);
  const queue = [roomId];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (!current) continue;
    const parents = roomToParents.get(current);
    if (!parents) continue;
    for (const parentId of parents) {
      if (visited.has(parentId)) continue;
      visited.add(parentId);
      if (isSpace(client.getRoom(parentId))) {
        if (joinedRoomIds.has(parentId)) return true;
      } else {
        queue.push(parentId);
      }
    }
  }
  return false;
};

/** Ordinary rooms outside any joined space (including sub-rooms of other unspaced rooms). */
export const getUnspacedHomeRooms = (
  client: MatrixClient,
  roomIds: string[],
  directRoomIds: ReadonlySet<string>,
  roomToParents: RoomToParents,
  joinedRoomIds: ReadonlySet<string>
): string[] =>
  roomIds.filter(
    (roomId) =>
      isOrdinaryRoom(client, roomId, directRoomIds) &&
      !isEnclosedByJoinedSpace(client, roomId, roomToParents, joinedRoomIds)
  );

/**
 * Rooms that message search covers from Home: all ordinary rooms (both unspaced and inside
 * spaces), excluding direct messages, spaces, and the server emoji room.
 */
export const getHomeSearchRooms = (
  client: MatrixClient,
  roomIds: string[],
  directRoomIds: ReadonlySet<string>
): string[] => roomIds.filter((roomId) => isOrdinaryRoom(client, roomId, directRoomIds));

/**
 * Unspaced ordinary room IDs the user has not archived; used by the rail's Home unread badge and
 * rail Mark as Read so Home never double-counts space rail tabs.
 */
export const useHomeRooms = (): string[] => {
  const client = useMatrixClient();
  const rooms = useAtomValue(allRoomsAtom);
  const listed = useAtomValue(navigationRoomsAtom);
  const directRoomIds = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  return useMemo(
    () => getUnspacedHomeRooms(client, listed, directRoomIds, roomToParents, new Set(rooms)),
    [client, listed, directRoomIds, roomToParents, rooms]
  );
};

/** Room IDs message search covers from Home: every ordinary room, including archived and SDK-cached ones. */
export const useHomeSearchRooms = (): string[] => {
  const client = useMatrixClient();
  const rooms = useAtomValue(allRoomsAtom);
  const directRoomIds = useAtomValue(mDirectAtom);
  return useMemo(() => {
    const sdkRooms = client.getRooms().map((room) => room.roomId);
    return getHomeSearchRooms(client, mergeHomeSearchRoomSources(rooms, sdkRooms), directRoomIds);
  }, [client, rooms, directRoomIds]);
};
