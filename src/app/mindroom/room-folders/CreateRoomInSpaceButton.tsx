import React from 'react';
import { Room } from 'matrix-js-sdk';
import { Icon, IconButton, Icons } from 'folds';
import { useTranslation } from 'react-i18next';
import { StateEvent } from '../../../types/matrix/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useOpenCreateRoomModal } from '../../state/hooks/createRoomModal';

export function CreateRoomInSpaceButton({ space }: { space: Room }) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const openCreateRoom = useOpenCreateRoomModal();
  const creators = useRoomCreators(space);
  const permissions = useRoomPermissions(creators, usePowerLevels(space));
  const canCreate = permissions.stateEvent(StateEvent.SpaceChild, mx.getSafeUserId());
  if (!canCreate) return null;

  return (
    <IconButton
      onClick={() => openCreateRoom(space.roomId)}
      aria-label={t('nav.createRoomInSpace', { name: space.name })}
      variant="Background"
      fill="None"
      size="300"
      radii="300"
    >
      <Icon src={Icons.Plus} size="50" />
    </IconButton>
  );
}
