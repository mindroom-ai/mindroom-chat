import { useMemo } from 'react';
import { Box, Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { ImagePack } from '../custom/ImagePack';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useServerEmojiRoom } from '../server/useServerEmojiRoom';
import { useRoomImagePacks } from '../useImagePacks';
import { readPowerLevel, usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useOpenRoomSettings } from '../../navigation/useRoomSettingsState';
import { RoomSettingsPage } from '../../navigation/roomSettingsState';
import { SequenceCard } from '../../ui/SequenceCard';
import { SettingTile } from '../../ui/SettingTile';
import { getMxIdServer } from '../../matrix/matrix';
import { SequenceCardStyle } from '../../ui/settings/styles.css';

type ImagePackLike = {
  deleted?: boolean;
  content?: Record<string, unknown>;
  meta?: { name?: string };
  address?: { roomId: string; stateKey: string };
};

/** A pack whose state event was cleared is gone, even though the event remains. */
const isDeletedPack = (pack: ImagePack): boolean => {
  const { deleted, content } = pack as unknown as ImagePackLike;
  if (typeof deleted === 'boolean') return deleted;
  return !content || Object.keys(content).length === 0;
};

const packName = (pack: ImagePack, fallback: string): string => {
  const like = pack as unknown as ImagePackLike;
  const contentName = (like.content?.pack as { display_name?: unknown } | undefined)?.display_name;
  return like.meta?.name ?? (typeof contentName === 'string' ? contentName : undefined) ?? fallback;
};

const SERVER_PACK_KEY = 'featureUi.settings.emojisStickers.serverPack';

/** Shared look of the section's tile buttons; Permissions adds an outline. */
const tileButton = { size: '300', variant: 'Secondary', fill: 'Soft', radii: '300' } as const;

type ServerPackSectionProps = {
  room: Room;
  onViewPack: (pack: ImagePack) => void;
};

function ServerPackSection({ room, onViewPack }: ServerPackSectionProps) {
  const { t } = useTranslation();
  const userId = useMatrixClient().getSafeUserId();
  const openRoomSettings = useOpenRoomSettings();
  const packs = useRoomImagePacks(room);
  // Room creators outrank every power level (room version 12).
  const creators = useRoomCreators(room);
  const powerLevels = usePowerLevels(room);

  const livePacks = useMemo(() => packs.filter((pack) => !isDeletedPack(pack)), [packs]);
  // A room without packs still offers its first one, so the first emoji can be added.
  const shownPacks = useMemo(
    () =>
      livePacks.length > 0
        ? livePacks
        : [new ImagePack(`${room.roomId}:`, {}, { roomId: room.roomId, stateKey: '' })],
    [livePacks, room.roomId]
  );

  const canChangePermissions =
    creators.has(userId) ||
    readPowerLevel.user(powerLevels, userId) >=
      readPowerLevel.state(powerLevels, 'm.room.power_levels');

  const sectionTitle = t(`${SERVER_PACK_KEY}.title`);
  const viewLabel = t('featureUi.settings.emojisStickers.globalPacks.view');
  const openPermissions = () =>
    openRoomSettings(room.roomId, RoomSettingsPage.PermissionsPage);

  const permissionsButton = canChangePermissions ? (
    <Button {...tileButton} outlined onClick={openPermissions}>
      <Text size="B300">{t(`${SERVER_PACK_KEY}.permissions`)}</Text>
    </Button>
  ) : undefined;

  const packTiles = shownPacks.map((pack) => (
    <SettingTile
      focusId="serverEmoji"
      key={pack.address?.stateKey ?? pack.id}
      title={packName(pack, sectionTitle)}
      after={
        <Button {...tileButton} onClick={() => onViewPack(pack)}>
          <Text size="B300">{viewLabel}</Text>
        </Button>
      }
    />
  ));

  return (
    <Box direction="Column" gap="100">
      <Text size="L400" data-settings-heading="">
        {sectionTitle}
      </Text>
      <SequenceCard
        variant="SurfaceVariant"
        className={SequenceCardStyle}
        gap="400"
        direction="Column"
      >
        <SettingTile
          focusId="serverEmoji"
          title={sectionTitle}
          description={t(`${SERVER_PACK_KEY}.description`, {
            server: getMxIdServer(userId) ?? '',
          })}
          after={permissionsButton}
        />
        {packTiles}
      </SequenceCard>
    </Box>
  );
}

type ServerPackProps = {
  onViewPack: (pack: ImagePack) => void;
};

/** The homeserver's shared emoji packs, when it has a server emoji room. */
export function ServerPack({ onViewPack }: ServerPackProps) {
  const room = useServerEmojiRoom();
  if (!room) return null;
  // Remount per room: the packs hook reads a room once per mounted section.
  return <ServerPackSection key={room.roomId} room={room} onViewPack={onViewPack} />;
}
