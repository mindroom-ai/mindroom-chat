import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import { StateEvent } from '../../matrix/types/room';
import { revealDirectionControls } from '../../ui/directional';

/** Why the signed-in user may not change which rooms `room` lists (`m.space.child`), if so. */
export const useListRoomsRefusal = (room: Room): string | undefined => {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const permissions = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  if (permissions.stateEvent(StateEvent.SpaceChild, client.getSafeUserId())) return undefined;
  return t('featureUi.subRooms.noPermission', { name: revealDirectionControls(room.name) });
};
