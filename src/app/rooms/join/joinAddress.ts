import type { IPublicRoomsChunkRoom } from 'matrix-js-sdk';
import { parseMatrixToRoom, parseMatrixToRoomEvent } from '../../matrix/matrix-to';
import { isRoomAlias, isRoomId } from '../../matrix/matrix';

export type JoinAddress = {
  roomIdOrAlias: string;
  viaServers?: string[];
  eventId?: string;
};

/**
 * Reads typed or pasted text as a room alias, a room ID, or a link to a room or event: matrix.to,
 * a `matrix:` URI or a link into this app, whatever else its query says (a thread, a tracking tag).
 */
export const parseJoinAddress = (value: string): JoinAddress | undefined => {
  const address = value.trim();
  if (isRoomAlias(address) || isRoomId(address)) return { roomIdOrAlias: address };
  const options = { allowExtraParams: true };
  return parseMatrixToRoomEvent(address, options) ?? parseMatrixToRoom(address, options);
};

/** A directory entry; servers on newer spec versions add the join rule and the room type. */
export type DirectoryRoom = IPublicRoomsChunkRoom & { join_rule?: string; room_type?: string };

/**
 * The rooms (not spaces, which Explore lists) whose name, address or topic contains the search
 * text, ignoring case. The whole text has to match, as the server's own search does, so the
 * list narrows the same way before and after the server answers.
 */
export const filterDirectoryRooms = (rooms: DirectoryRoom[], search: string): DirectoryRoom[] => {
  const needle = search.trim().toLocaleLowerCase();
  return rooms.filter((room) => {
    if (room.room_type === 'm.space') return false;
    if (!needle) return true;
    const haystack = [room.name, room.canonical_alias, room.topic, ...(room.aliases ?? [])];
    return haystack.some((text) => !!text && text.toLocaleLowerCase().includes(needle));
  });
};
