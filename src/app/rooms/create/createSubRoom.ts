import type { Room } from 'matrix-js-sdk';
import type { ClientConfig } from '../../config/useClientConfig';
import i18n from '../../i18n/i18n';
import { createRoom } from '../../matrix/createRoom';
import { CreateRoomAccess } from '../../matrix/createRoomTypes';
import { getPowersLevelFromMatrixEvent } from '../../matrix/hooks/usePowerLevels';
import { getRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { getRoomPermissionsAPI } from '../../matrix/hooks/useRoomPermissions';
import { getStateEvent } from '../../matrix/room';
import { StateEvent } from '../../matrix/types/room';
import { revealDirectionControls } from '../../ui/directional';

/** Whether the signed-in user may change which rooms `room` lists (`m.space.child`). */
const mayListRooms = (room: Room): boolean => {
  const createEvent = getStateEvent(room, StateEvent.RoomCreate);
  const creators = createEvent ? getRoomCreators(createEvent) : new Set<string>();
  const levels = getPowersLevelFromMatrixEvent(getStateEvent(room, StateEvent.RoomPowerLevels));
  return getRoomPermissionsAPI(creators, levels).stateEvent(
    StateEvent.SpaceChild,
    room.client.getSafeUserId()
  );
};

/**
 * Creates the room New Sub-room creates and resolves to its ID: `name`, trimmed, listed under
 * `parent` (`m.space.child` there, and the new room's canonical `m.space.parent`), open only to the
 * members of `parent` (`restricted`), encrypted and federated as `policy` (config.json's
 * `createRoom`) says, both by default, in the homeserver's default room version. A blank name, and
 * a parent where the signed-in user may not list rooms, are refused before anything is created.
 */
export const createSubRoom = async (
  parent: Room,
  name: string,
  policy: ClientConfig['createRoom']
): Promise<string> => {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('A sub-room needs a name.');
  if (!mayListRooms(parent)) {
    throw new Error(
      i18n.t('featureUi.subRooms.noPermission', { name: revealDirectionControls(parent.name) })
    );
  }
  const { client } = parent;
  return createRoom(client, {
    name: trimmed,
    parent,
    access: CreateRoomAccess.Restricted,
    knock: false,
    encryption: policy?.defaultEncryption ?? true,
    allowFederation: policy?.defaultFederation ?? true,
    version: client.getCachedCapabilities()?.['m.room_versions']?.default,
  });
};
