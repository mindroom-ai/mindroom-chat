import React from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Box, Button, Text, color } from 'folds';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import { SettingsPageFrame } from '../../features/settings/SettingsPageFrame';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { joinedArchivedRoomsAtom } from './archivedRooms';
import { useRoomArchiveAction } from './useRoomArchiveAction';

/** The settings page that lists archived rooms. */
export const ARCHIVED_ROOMS_SETTINGS_PAGE = 'archived-rooms' as const;

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
      title={name}
      after={
        <Box gap="200" alignItems="Center">
          <Button size="300" variant="Secondary" fill="Soft" radii="300" onClick={onOpen}>
            <Text size="B300">{t('archivedRooms.open')}</Text>
          </Button>
          <Button
            size="300"
            variant="Primary"
            fill="Soft"
            radii="300"
            disabled={busy}
            onClick={() => {
              toggle().catch(() => undefined);
            }}
          >
            <Text size="B300">{t('archivedRooms.unarchive')}</Text>
          </Button>
        </Box>
      }
    >
      {failed && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {t('archivedRooms.unarchiveFailed')}
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



  const roomIds = useAtomValue(joinedArchivedRoomsAtom);
  const rooms = roomIds
    .map((roomId) => mx.getRoom(roomId))
    .filter((room): room is NonNullable<typeof room> => !!room)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <SettingsPageFrame title={t('archivedRooms.title')} requestClose={requestClose}>
      <Box direction="Column" gap="100">
        <Text size="L400">{t('archivedRooms.title')}</Text>
        <SequenceCard variant="SurfaceVariant" direction="Column" gap="400">
          {rooms.length === 0 ? (
            <SettingTile title={t('archivedRooms.empty')} />
          ) : (
            rooms.map((room) => (
              <ArchivedRoomRow



                onOpen={() => {
                  navigateRoom(room.roomId);
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
