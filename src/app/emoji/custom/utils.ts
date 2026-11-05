import { EventTimeline, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../matrix/types/accountData';
import { StateEvent } from '../../matrix/types/room';
import { getAccountData } from '../../matrix/room';
import { ImagePack } from './ImagePack';
import { EmoteRoomsContent, ImageUsage, PackContent, PackImage, PackImages } from './types';
import { isRecord } from '../../lib/isRecord';

/**
 * The largest pack event, as the JSON bytes of its content, that new images go into. Servers
 * refuse events over 64 KiB, and the margin leaves room for the event's other fields and edits.
 */
export const MAX_PACK_CONTENT_BYTES = 30_000;

/** Thrown when a pack already has an image under the shortcode. */
export class ShortcodeTakenError extends Error {
  readonly shortcode: string;

  constructor(shortcode: string) {
    super(`The shortcode "${shortcode}" is taken`);
    this.name = 'ShortcodeTakenError';
    this.shortcode = shortcode;
  }
}

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

/** The size of pack content as the server counts it: the UTF-8 bytes of its JSON. */
export const packContentBytes = (content: PackContent): number =>
  new TextEncoder().encode(JSON.stringify(content)).length;

/**
 * Pack content with the image added as an emoji under `shortcode`, keeping the pack's metadata
 * and other images. In a pack whose images are stickers only, the image is marked as an emoji.
 * Throws `ShortcodeTakenError` when the pack has the shortcode, whatever its image is used as.
 */
export const addEmoticonToPackContent = (
  content: PackContent | undefined,
  shortcode: string,
  image: PackImage
): PackContent => {
  const existing = content?.images;
  const images: PackImages = isRecord(existing) ? existing : {};
  if (hasOwn(images, shortcode)) throw new ShortcodeTakenError(shortcode);

  const usage = image.usage ?? content?.pack?.usage;
  const emoticon: PackImage =
    Array.isArray(usage) && !usage.includes(ImageUsage.Emoticon)
      ? { ...image, usage: [...(image.usage ?? []), ImageUsage.Emoticon] }
      : image;
  // A computed key defines an own property, even for a shortcode such as `__proto__`.
  return { ...content, images: { ...images, [shortcode]: emoticon } };
};

/**
 * The state key for a new pack after the given ones: `''` is the first pack, and further packs
 * take the smallest unused number from 2 up.
 */
export const nextPackStateKey = (stateKeys: string[]): string => {
  const taken = new Set(stateKeys);
  let next = 2;
  while (taken.has(String(next))) next += 1;
  return String(next);
};

/** Whether any of the packs has an image under the shortcode. */
export const packsHaveShortcode = (packs: ImagePack[], shortcode: string): boolean =>
  packs.some(
    (pack) =>
      pack.images.collection.has(shortcode) ||
      (isRecord(pack.content.images) && hasOwn(pack.content.images, shortcode))
  );

const roomPackEvents = (room: Room): MatrixEvent[] =>
  room
    .getLiveTimeline()
    .getState(EventTimeline.FORWARDS)
    ?.getStateEvents(StateEvent.PoniesRoomEmotes) ?? [];

const packFromStateEvent = (roomId: string, event: MatrixEvent): ImagePack =>
  new ImagePack(event.getId() ?? '', event.getContent<PackContent>(), {
    roomId,
    stateKey: event.getStateKey() ?? '',
  });

/** The room's packs, one per `im.ponies.room_emotes` state key, deleted ones included. */
export const getRoomImagePacks = (room: Room): ImagePack[] =>
  roomPackEvents(room).map((event) => packFromStateEvent(room.roomId, event));

/** The user's own pack (`im.ponies.user_emotes`), when the user has one. */
export const getUserImagePack = (mx: MatrixClient): ImagePack | undefined => {
  const event = getAccountData(mx, AccountDataEvent.PoniesUserEmotes);
  const userId = mx.getUserId();
  if (!event || !userId) return undefined;
  return new ImagePack(userId, event.getContent<PackContent>(), undefined);
};

/** The room packs the user enabled in every room (`im.ponies.emote_rooms`), from joined rooms. */
export const getGlobalImagePacks = (mx: MatrixClient): ImagePack[] => {
  const listed = getAccountData(
    mx,
    AccountDataEvent.PoniesEmoteRooms
  )?.getContent<EmoteRoomsContent>()?.rooms;
  const rooms = isRecord(listed) ? listed : {};
  return Object.keys(rooms).flatMap((roomId) => {
    const room = mx.getRoom(roomId);
    const stateKeys = rooms[roomId];
    if (!room || !isRecord(stateKeys)) return [];
    return roomPackEvents(room)
      .filter((event) => hasOwn(stateKeys, event.getStateKey() ?? ''))
      .map((event) => packFromStateEvent(roomId, event))
      .filter((pack) => !pack.deleted);
  });
};
