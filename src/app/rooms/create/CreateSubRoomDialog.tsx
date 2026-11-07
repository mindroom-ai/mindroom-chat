import { type FormEvent, useId, useState } from 'react';
import { Box, Button, Input, Spinner, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Room } from 'matrix-js-sdk';
import { CreateDialogFrame } from '../../ui/CreateDialogFrame';
import { ErrorDetail } from '../../ui/ErrorDetail';
import { revealDirectionControls } from '../../ui/directional';
import { createRoom } from '../../matrix/createRoom';
import { CreateRoomAccess } from '../../matrix/createRoomTypes';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useCapabilities } from '../../matrix/hooks/useCapabilities';
import { useRoomName } from '../../matrix/hooks/useRoomMeta';
import { getCanonicalAliasOrRoomId } from '../../matrix/matrix';
import { waitForJoinedRoom } from '../../matrix/waitForJoinedRoom';
import { useClientConfig } from '../../config/useClientConfig';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { describeError } from '../../lib/describeError';
import { useListRoomsRefusal } from './useListRoomsRefusal';
import { getSpaceRoomPath } from '../../routes/pathUtils';

type CreateSubRoomDialogProps = {
  parent: Room;
  /** The space the parent is listed or open in, which the new room opens in too. */
  spaceId?: string;
  requestClose: () => void;
};

/**
 * New Sub-room: a room listed under `parent` (`m.space.child` there, and the new room's canonical
 * `m.space.parent`) that only the members of `parent` may join (`restricted`). The agents in
 * `parent` join it on their own. It opens once sync has it.
 */
export function CreateSubRoomDialog({ parent, spaceId, requestClose }: CreateSubRoomDialogProps) {
  const { t } = useTranslation();
  const nameId = useId();
  const client = useMatrixClient();
  const navigate = useNavigate();
  const { navigateRoom } = useRoomNavigate();
  const { createRoom: policy } = useClientConfig();
  const version = useCapabilities()['m.room_versions']?.default;
  const parentName = revealDirectionControls(useRoomName(parent));
  // Who may no longer list rooms in the parent, since the menu offered this, gets the reason.
  const refusal = useListRoomsRefusal(parent);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<{ reason: unknown }>();

  const open = (roomId: string) => {
    if (!spaceId) navigateRoom(roomId);
    else {
      navigate(
        getSpaceRoomPath(
          getCanonicalAliasOrRoomId(client, spaceId),
          getCanonicalAliasOrRoomId(client, roomId)
        )
      );
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || refusal) return;
    setError(undefined);
    setCreating(true);
    try {
      const roomId = await createRoom(client, {
        name: trimmed,
        parent,
        access: CreateRoomAccess.Restricted,
        knock: false,
        encryption: policy?.defaultEncryption ?? true,
        allowFederation: policy?.defaultFederation ?? true,
        version,
      });
      requestClose();
      waitForJoinedRoom(client, roomId).then(
        () => open(roomId),
        () => open(roomId)
      );
    } catch (reason) {
      setError({ reason });
      setCreating(false);
    }
  };

  return (
    <CreateDialogFrame title={t('featureUi.subRooms.newSubRoom')} requestClose={requestClose}>
      <Box
        as="form"
        grow="Yes"
        direction="Column"
        gap="500"
        onSubmit={(event: FormEvent<HTMLFormElement>) => void submit(event)}
      >
        <Text size="T300">{t('featureUi.subRooms.description', { name: parentName })}</Text>
        <Box direction="Column" gap="100">
          <Text as="label" htmlFor={nameId} size="L400">
            {t('featureUi.createRoom.name')}
          </Text>
          <Input
            id={nameId}
            variant="SurfaceVariant"
            size="500"
            radii="400"
            disabled={creating}
            autoComplete="off"
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </Box>
        {refusal && (
          <Text size="T300" style={{ color: color.Critical.Main }}>
            {refusal}
          </Text>
        )}
        {error !== undefined && (
          <Text role="alert" size="T300" style={{ color: color.Critical.Main }}>
            {describeError(t, error.reason)}
            <ErrorDetail error={error.reason} />
          </Text>
        )}
        <Button
          type="submit"
          variant="Primary"
          size="500"
          radii="400"
          disabled={creating || !!refusal}
          before={creating ? <Spinner variant="Primary" fill="Solid" size="200" /> : undefined}
        >
          <Text size="B500">{t('featureUi.createRoom.create')}</Text>
        </Button>
      </Box>
    </CreateDialogFrame>
  );
}
