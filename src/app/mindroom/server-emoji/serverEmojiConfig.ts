import type { AutoDiscoveryInfo } from '../../cs-api';

/** The well-known key a homeserver uses to name its shared emoji room. */
const SERVER_EMOJI_WELL_KNOWN_KEY = 'io.mindroom.emoji';

const ROOM_ALIAS = /^#[^:]+:.+$/;
// Room version 12 room IDs carry no server name.
const ROOM_ID = /^![^:]+(:.+)?$/;

/**
 * The room the homeserver's `.well-known/matrix/client` names for its emoji
 * (`{"io.mindroom.emoji": {"room": "#emoji:example.org"}}`): a room alias or ID, or undefined
 * when the key is missing or malformed.
 */
export const getServerEmojiRoomAddress = (
  info: AutoDiscoveryInfo | undefined
): string | undefined => {
  const value = info?.[SERVER_EMOJI_WELL_KNOWN_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { room } = value as { room?: unknown };
  if (typeof room !== 'string') return undefined;
  return ROOM_ALIAS.test(room) || ROOM_ID.test(room) ? room : undefined;
};
