import type { IImageInfo } from '../../../types/matrix/common';

// Image packs as MSC2545 describes them: `im.ponies.room_emotes` room state (one pack per state
// key), `im.ponies.user_emotes` account data (the user's own pack) and `im.ponies.emote_rooms`
// account data (room packs the user enabled everywhere).

/** What an image may be used as. */
export const ImageUsage = {
  Emoticon: 'emoticon',
  Sticker: 'sticker',
} as const;
export type ImageUsage = (typeof ImageUsage)[keyof typeof ImageUsage];

/** Content of a pack: room state or the user's account data. Both fields are optional. */






















};

/** Where a room pack lives. */
export type PackAddress = {
  roomId: string;
  stateKey: string;
};

/** `im.ponies.emote_rooms`: the room packs, by room ID and state key, the user uses everywhere. */
export type EmoteRoomsContent = {
  rooms?: Record<string, Record<string, object>>;
};
