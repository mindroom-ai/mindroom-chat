import { useMemo } from 'react';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from './useMatrixClient';
import { getAncestorSpaceIds } from '../state/room/spaceAncestors';
import { useServerEmojiRoom } from '../mindroom/server-emoji/useServerEmojiRoom';

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
    // The room, then every space above it, nearest first.
    const ids = [roomId, ...getAncestorSpaceIds(parentsByRoom, roomId)];
    if (serverEmojiRoom && !ids.includes(serverEmojiRoom.roomId)) ids.push(serverEmojiRoom.roomId);
    return ids
      .map((id) => (id === serverEmojiRoom?.roomId ? serverEmojiRoom : client.getRoom(id)))
      .filter((room): room is Room => !!room);
  }, [client, roomId, parentsByRoom, serverEmojiRoom]);
};
