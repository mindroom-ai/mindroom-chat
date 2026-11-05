import type { IImageInfo } from '../../matrix/types/common';

// Image packs as MSC2545 describes them: `im.ponies.room_emotes` room state (one pack per state
// key), `im.ponies.user_emotes` account data (the user's own pack) and `im.ponies.emote_rooms`
// account data (room packs the user enabled everywhere).

/** What an image may be used as. */
export const ImageUsage = {
  Emoticon: 'emoticon',
  Sticker: 'sticker',
} as const;
export type ImageUsage = (typeof ImageUsage)[keyof typeof ImageUsage];

/** The `usage` field that both a pack and each of its images may carry. */
type UsageHint = { usage?: ImageUsage[] };

/** Content of a pack: room state or the user's account data. Both fields are optional. */
export type PackContent = { images?: PackImages; pack?: PackMeta };

/** The `pack` object: name, avatar, the default usage of its images, and credits. */
export type PackMeta = UsageHint &
  Partial<Record<'attribution' | 'avatar_url' | 'display_name', string>>;

/** Images by shortcode, the text between the colons in `:shortcode:`. */
export type PackImages = Record<string, PackImage>;

/** One image; `usage` overrides the pack's and `body` is its description. */
export type PackImage = UsageHint & { url: string; body?: string; info?: IImageInfo };

/** Where a room pack lives. */
export type PackAddress = {
  roomId: string;
  stateKey: string;
};

/** `im.ponies.emote_rooms`: the room packs, by room ID and state key, the user uses everywhere. */
export type EmoteRoomsContent = {
  rooms?: Record<string, Record<string, object>>;
};
