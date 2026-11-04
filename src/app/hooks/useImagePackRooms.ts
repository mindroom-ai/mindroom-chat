import { useMemo } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';
import { useServerEmojiRoom } from '../mindroom/server-emoji/useServerEmojiRoom';

/** The room, then every space above it, nearest first. */
const getRoomAndAncestorIds = (roomId: string, roomToParents: Map<string, Set<string>>) => {
  const ids = [roomId];
  const seen = new Set(ids);
  // The loop also visits the parents pushed while it runs.
  for (const id of ids) {
    roomToParents.get(id)?.forEach((parentId) => {
      if (seen.has(parentId)) return;
      seen.add(parentId);
      ids.push(parentId);
    });
  }
  return ids;
};

/**
 * The rooms whose image packs the emoji and sticker pickers offer in `roomId`: the room itself,
 * its parent spaces, and the homeserver's shared emoji room when the account has joined it.
 */
export const useImagePackRooms = (
  roomId: string,
  parentsByRoom: Map<string, Set<string>>
): Room[] => {
  const client = useMatrixClient();
  const serverEmojiRoom = useServerEmojiRoom();

  return useMemo(() => {
    const ids = getRoomAndAncestorIds(roomId, parentsByRoom);
    if (serverEmojiRoom && !ids.includes(serverEmojiRoom.roomId)) ids.push(serverEmojiRoom.roomId);
    return ids
      .map((id) => (id === serverEmojiRoom?.roomId ? serverEmojiRoom : client.getRoom(id)))
      .filter((room): room is Room => !!room);
  }, [client, roomId, parentsByRoom, serverEmojiRoom]);
};
