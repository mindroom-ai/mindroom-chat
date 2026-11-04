import React, { useState } from 'react';
import { Avatar, Box, Button, Spinner, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { RoomAvatar } from '../../../components/room-avatar';
import { RoomIcon } from '../../../components/room-avatar/RoomAvatar';
import { SettingTile } from '../../../components/setting-tile';
import { useAlive } from '../../../hooks/useAlive';
import { useFilePicker } from '../../../hooks/useFilePicker';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { usePowerLevels } from '../../../hooks/usePowerLevels';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomAvatar, useRoomName } from '../../../hooks/useRoomMeta';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import { useStateEvent } from '../../../hooks/useStateEvent';
import { mxcUrlToHttp } from '../../../utils/mediaUrl';
import { nameInitials } from '../../../utils/common';
import { StateEvent } from '../../../../types/matrix/room';

const PROFILE = 'featureUi.commonSettings.general.roomProfile';
const PICTURE_PX = 160;

/**
 * The room's picture (`m.room.avatar`), with Upload and Remove for those allowed to change it.
 * The new picture shows once the server echoes the state event.
 */
export function RoomAvatarTile({ room, space }: { room: Room; space: boolean }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const authenticated = useMediaAuthentication();
  const may = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const name = useRoomName(room);
  const mxc = useRoomAvatar(room);
  const joinRule = useStateEvent(room, StateEvent.RoomJoinRules)?.getContent().join_rule;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const allowed = may.stateEvent(StateEvent.RoomAvatar, client.getSafeUserId());
  const src = mxc
    ? mxcUrlToHttp(client, mxc, authenticated, PICTURE_PX, PICTURE_PX, 'crop') ?? undefined
    : undefined;

  const setPicture = (change: () => Promise<string>) => {
    setBusy(true);
    setFailed(false);
    change()
      .then((url) =>
        client.sendStateEvent(
          room.roomId,
          StateEvent.RoomAvatar as never,
          (url ? { url } : {}) as never,
          ''
        )
      )
      .catch(() => alive() && setFailed(true))
      .finally(() => alive() && setBusy(false));
  };

  const pick = useFilePicker(
    (file: File) =>
      setPicture(async () => {
        const { content_uri: uploaded } = await client.uploadContent(file, {
          name: file.name,
          type: file.type,
        });
        return uploaded;
      }),
    false,
    'image/*'
  );

  const rule = typeof joinRule === 'string' ? joinRule : undefined;
  // A space reads as its initials, as on its rail button; a room as its kind of room.
  const icon = () =>
    space ? (
      <Text size="H4">{nameInitials(name)}</Text>
    ) : (
      <RoomIcon size="300" filled joinRule={rule} />
    );
  const picture = (
    <Avatar size="500" radii={space ? '400' : '300'}>
      <RoomAvatar alt={name} src={src} renderFallback={icon} roomId={room.roomId} />
    </Avatar>
  );

  return (
    <SettingTile title={t(`${PROFILE}.avatar`)} before={picture}>
      {allowed && (
        <Box gap="200" wrap="Wrap">
          <Button
            size="300"
            radii="300"
            variant="Secondary"
            fill="Soft"
            disabled={busy}
            before={busy ? <Spinner size="50" variant="Secondary" /> : undefined}
            onClick={pick}
          >
            <Text size="B300">{t(`${PROFILE}.upload`)}</Text>
          </Button>
          {mxc && (
            <Button
              size="300"
              radii="300"
              variant="Critical"
              fill="None"
              disabled={busy}
              onClick={() => setPicture(async () => '')}
            >
              <Text size="B300">{t(`${PROFILE}.remove`)}</Text>
            </Button>
          )}
        </Box>
      )}
      {failed && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {t(
            'featureUi.commonSettings.permissions.permissionGroups.failedToApplyChangesPleaseTryAgain'
          )}
        </Text>
      )}
    </SettingTile>
  );
}
