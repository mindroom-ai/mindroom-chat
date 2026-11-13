import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { waitForJoinedRoom } from '../../matrix/waitForJoinedRoom';
import {
  useCloseCreateSpaceModal,
  useCreateSpaceModalState,
} from '../../navigation/useCreateSpaceModal';
import { CreateDialogFrame } from '../../ui/CreateDialogFrame';
import { CreateRoomForm } from '../../rooms/create/CreateRoom';

/**
 * The "Create Space" dialog, opened from the icon rail, the command palette or a lobby. A new
 * top-level space opens once sync has it; a subspace stays in the lobby it was added to.
 */
export function CreateSpaceModalRenderer() {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const requested = useCreateSpaceModalState();
  const close = useCloseCreateSpaceModal();
  const { navigateSpace } = useRoomNavigate();
  if (!requested) return null;

  const parent = requested.spaceId ? client.getRoom(requested.spaceId) ?? undefined : undefined;
  const title = parent
    ? t('featureUi.createSpace.createSpaceModal.newSpace')
    : t('nav.createSpace');

  const handleCreated = (spaceId: string) => {
    close();
    if (parent) return;
    waitForJoinedRoom(client, spaceId).then(
      () => navigateSpace(spaceId),
      () => navigateSpace(spaceId)
    );
  };

  return (
    <CreateDialogFrame title={title} requestClose={close}>
      <CreateRoomForm
        key={requested.spaceId ?? ''}
        kind="space"
        space={parent}
        onCreate={handleCreated}
      />
    </CreateDialogFrame>
  );
}
