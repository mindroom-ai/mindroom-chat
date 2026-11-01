import type { MatrixClient, Room } from 'matrix-js-sdk';
import { StateEvent } from '../../../types/matrix/room';
import { ErrorCode } from '../../cs-errorcode';
import { getPowersLevelFromMatrixEvent } from '../../hooks/usePowerLevels';
import { getRoomCreators } from '../../hooks/useRoomCreators';
import { getRoomPermissionsAPI } from '../../hooks/useRoomPermissions';
import {
  addEmoticonToPackContent,
  getRoomImagePacks,
  MAX_PACK_CONTENT_BYTES,
  nextPackStateKey,
  packContentBytes,
  PackContent,
  PackImage,
  PackMeta,
  packsHaveShortcode,
  ShortcodeTakenError,
} from '../../plugins/custom-emoji';
import { getStateEvent } from '../../utils/room';

/** Whether the user's power level allows adding to the room's emoji packs. */
export const canAddServerEmoji = (mx: MatrixClient, room: Room): boolean => {
  const createEvent = getStateEvent(room, StateEvent.RoomCreate);
  if (!createEvent) return false;
  const powerLevels = getPowersLevelFromMatrixEvent(
    getStateEvent(room, StateEvent.RoomPowerLevels)
  );
  return getRoomPermissionsAPI(getRoomCreators(createEvent), powerLevels).stateEvent(
    StateEvent.PoniesRoomEmotes,
    mx.getSafeUserId()
  );
};

/** The pack as the server has it; `undefined` when the room has no pack at that state key. */
const fetchPackContent = async (
  mx: MatrixClient,
  roomId: string,
  stateKey: string
): Promise<PackContent | undefined> => {
  try {
    return await mx.getStateEvent(roomId, StateEvent.PoniesRoomEmotes, stateKey);
  } catch (error) {
    if ((error as { errcode?: string })?.errcode !== ErrorCode.M_NOT_FOUND) throw error;
    return undefined;
  }
};

/**
 * Adds an image to the server emoji room's first pack with room for it, or to a new pack
 * when every pack is full. Throws `ShortcodeTakenError` when a server pack has the shortcode.
 */
export const addToServerPack = async (
  mx: MatrixClient,
  room: Room,
  shortcode: string,
  image: PackImage
): Promise<void> => {
  const packs = getRoomImagePacks(room).filter((pack) => !pack.deleted);
  // A shortcode names one emoji across all the server packs.
  if (packsHaveShortcode(packs, shortcode)) throw new ShortcodeTakenError(shortcode);
  // Candidate packs: live, in state-key order ('' first); none yet means ''.
  const keys = packs.flatMap((pack) => (pack.address ? [pack.address.stateKey] : [])).sort();
  if (keys.length === 0) keys.push('');

  let firstMeta: PackMeta | undefined;
  for (const key of keys) {
    // Read the pack from the server right before writing, so an edit made since the last sync
    // is kept, and a shortcode taken since throws. One pack at a time: the next is only tried
    // when this one is full.
    const current = await fetchPackContent(mx, room.roomId, key);
    firstMeta ??= current?.pack;
    const content = addEmoticonToPackContent(current, shortcode, image);
    if (packContentBytes(content) <= MAX_PACK_CONTENT_BYTES) {
      await mx.sendStateEvent(room.roomId, StateEvent.PoniesRoomEmotes as any, content, key);
      return;
    }
  }

  await mx.sendStateEvent(
    room.roomId,
    StateEvent.PoniesRoomEmotes as any,
    addEmoticonToPackContent({ pack: firstMeta }, shortcode, image),
    nextPackStateKey(keys)
  );
};
