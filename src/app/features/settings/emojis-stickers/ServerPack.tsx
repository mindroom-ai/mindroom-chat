import React, { useMemo } from 'react';
import { Box, Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { ImagePack } from '../../../plugins/custom-emoji';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useServerEmojiRoom } from '../../../mindroom/server-emoji/useServerEmojiRoom';
import { useRoomImagePacks } from '../../../hooks/useImagePacks';
import { readPowerLevel, usePowerLevels } from '../../../hooks/usePowerLevels';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useOpenRoomSettings } from '../../../state/hooks/roomSettings';
import { RoomSettingsPage } from '../../../state/roomSettings';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { getMxIdServer } from '../../../utils/matrix';
import { SequenceCardStyle } from '../styles.css';

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

type ServerPackSectionProps = {
  room: Room;
  onViewPack: (pack: ImagePack) => void;
};

function ServerPackSection({ room, onViewPack }: ServerPackSectionProps) {



  const packs = useRoomImagePacks(room);




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

  const server = getMxIdServer(userId) ?? '';

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('featureUi.settings.emojisStickers.serverPack.title')}</Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <SettingTile
          title={t('featureUi.settings.emojisStickers.serverPack.title')}
          description={t('featureUi.settings.emojisStickers.serverPack.description', { server })}
          after={
            canChangePermissions ? (
              <Button
                size="300"
                variant="Secondary"
                fill="Soft"
                radii="300"
                outlined
                onClick={() =>
                  openRoomSettings(room.roomId, undefined, RoomSettingsPage.PermissionsPage)
                }
              >
                <Text size="B300">
                  {t('featureUi.settings.emojisStickers.serverPack.permissions')}
                </Text>
              </Button>
            ) : undefined
          }
        />
        {shownPacks.map((pack) => (
          <SettingTile
            key={pack.address?.stateKey ?? pack.id}
            title={packName(pack, t('featureUi.settings.emojisStickers.serverPack.unnamed'))}
            after={
              <Button
                size="300"
                variant="Secondary"
                fill="Soft"
                radii="300"
                onClick={() => onViewPack(pack)}
              >
                <Text size="B300">{t('featureUi.settings.emojisStickers.view')}</Text>
              </Button>
            }
          />
        ))}
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
