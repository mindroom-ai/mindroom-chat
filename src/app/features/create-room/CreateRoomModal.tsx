import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { waitForJoinedRoom } from '../../mindroom/matrix/waitForJoinedRoom';
import { getSpaceRoomPath } from '../../pages/pathUtils';
import {
  useCloseCreateRoomModal,
  useCreateRoomModalState,
} from '../../state/hooks/createRoomModal';
import { getCanonicalAliasOrRoomId } from '../../utils/matrix';
import { CreateDialogFrame } from '../create-space/CreateDialogFrame';
import { CreateRoomForm } from './CreateRoom';

/**
 * The "Create Room" dialog, opened from a lobby (for a room in that space) or the command
 * palette. The new room opens once sync has it: inside its space when it was made in one.
 */
export function CreateRoomModalRenderer() {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const navigate = useNavigate();
  const { navigateRoom } = useRoomNavigate();
  const requested = useCreateRoomModalState();
  const close = useCloseCreateRoomModal();
  if (!requested) return null;

  const space = requested.spaceId ? client.getRoom(requested.spaceId) ?? undefined : undefined;

  const openCreated = (roomId: string) => {
    if (space) {
      navigate(
        getSpaceRoomPath(
          getCanonicalAliasOrRoomId(client, space.roomId),
          getCanonicalAliasOrRoomId(client, roomId)
        )
      );
    } else {
      navigateRoom(roomId);
    }
  };
  const handleCreated = (roomId: string) => {
    close();
    waitForJoinedRoom(client, roomId).then(
      () => openCreated(roomId),
      () => openCreated(roomId)
    );
  };

  return (
    <CreateDialogFrame title={t('nav.createRoom')} requestClose={close}>
      <CreateRoomForm key={requested.spaceId ?? ''} space={space} onCreate={handleCreated} />
    </CreateDialogFrame>
  );
}
