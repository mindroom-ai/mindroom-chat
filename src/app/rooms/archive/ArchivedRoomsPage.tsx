import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Box, Button, Text, color } from 'folds';
import { SequenceCard } from '../../ui/SequenceCard';
import { SettingTile } from '../../ui/SettingTile';
import { SettingsPageFrame } from '../../ui/settings/SettingsPageFrame';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { joinedArchivedRoomsAtom } from '../../matrix/state/archivedRooms';
import { useRoomArchiveAction } from './useRoomArchiveAction';

type ArchivedRoomRowProps = {
  roomId: string;
  name: string;
  onOpen: () => void;
};

function ArchivedRoomRow({ roomId, name, onOpen }: ArchivedRoomRowProps) {
  const { t } = useTranslation();
  const { busy, failed, toggle } = useRoomArchiveAction(roomId);

  return (
    <SettingTile
      focusId="archivedRooms"
      title={
        <Box
          as="button"
          type="button"
          onClick={onOpen}
          style={{
            all: 'unset',
            cursor: 'pointer',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {name}
        </Box>
      }
      after={
        <Button
          size="300"
          variant="Secondary"
          fill="Soft"
          radii="300"
          disabled={busy}
          aria-label={t('archivedRooms.restoreNamed', { room: name })}
          onClick={() => {
            toggle().catch((error: unknown) => {
              // eslint-disable-next-line no-console
              console.warn('[archived-rooms] could not restore the room', roomId, error);
            });
          }}
        >
          <Text size="B300">{t('archivedRooms.restore')}</Text>
        </Button>
      }
    >
      {failed && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {t('archivedRooms.failed')}
        </Text>
      )}
    </SettingTile>
  );
}

type ArchivedRoomsProps = {
  requestClose: () => void;
  /** Called when a room opens from the list, so the settings dialog can close. */
  onNavigate: () => void;
};

/**
 * Settings → Archived Rooms: the joined rooms the user archived, hidden from the room list.
 * Each can be opened as it is or brought back into the list.
 */
export function ArchivedRooms({ requestClose, onNavigate }: ArchivedRoomsProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const { navigateRoom } = useRoomNavigate();
  const roomIds = useAtomValue(joinedArchivedRoomsAtom);
  const rooms = roomIds
    .map((roomId) => client.getRoom(roomId))
    .filter((room): room is NonNullable<typeof room> => !!room)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <SettingsPageFrame title={t('archivedRooms.title')} requestClose={requestClose}>
      <Box direction="Column" gap="100">
        <Text size="T300" priority="300" data-settings-heading="">
          {t('archivedRooms.description')}
        </Text>
        <SequenceCard variant="SurfaceVariant" direction="Column" gap="400">
          {rooms.length === 0 ? (
            <SettingTile focusId="archivedRooms" title={t('archivedRooms.empty')} />
          ) : (
            rooms.map(({ roomId, name }) => (
              <ArchivedRoomRow
                key={roomId}
                roomId={roomId}
                name={name}
                onOpen={() => {
                  navigateRoom(roomId);
                  onNavigate();
                }}
              />
            ))
          )}
        </SequenceCard>
      </Box>
    </SettingsPageFrame>
  );
}
