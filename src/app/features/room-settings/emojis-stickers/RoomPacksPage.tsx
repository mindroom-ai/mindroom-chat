import React, { type FormEvent, useMemo, useState } from 'react';
import { Box, Button, Input, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { ImagePackView } from '../../../components/image-pack-view';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useRoomImagePacks } from '../../../hooks/useImagePacks';
import { usePowerLevels } from '../../../hooks/usePowerLevels';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import { type ImagePack, nextPackStateKey } from '../../../plugins/custom-emoji';
import { StateEvent } from '../../../../types/matrix/room';
import { SettingsCard } from '../../settings/SettingsCard';
import { SettingsPageFrame } from '../../settings/SettingsPageFrame';

const PACKS = 'featureUi.commonSettings.emojisStickers.roomPacks';

/** A name field and Create, for those who may add packs to the room. */
function NewPackForm({ room, stateKeys }: { room: Room; stateKeys: string[] }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);
  const trimmed = name.trim();

  const create = (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    if (!trimmed || creating) return;
    setCreating(true);
    setFailed(false);
    client
      .sendStateEvent(
        room.roomId,
        StateEvent.PoniesRoomEmotes as never,
        { pack: { display_name: trimmed }, images: {} } as never,
        nextPackStateKey(stateKeys)
      )
      .then(
        () => setName(''),
        () => setFailed(true)
      )
      .finally(() => setCreating(false));
  };

  return (
    <SettingTile
      title={t(`${PACKS}.newPack`)}
      description={t(`${PACKS}.addYourOwnEmojiAndStickerPack`)}
    >
      <Box as="form" gap="200" alignItems="Center" onSubmit={create}>
        <Box grow="Yes" direction="Column">
          <Input
            value={name}
            onChange={(evt) => setName(evt.currentTarget.value)}
            aria-label={t(`${PACKS}.name`)}
            placeholder={t(`${PACKS}.name`)}
            variant="Background"
            size="300"
            radii="300"
          />
        </Box>
        <Button
          type="submit"
          size="300"
          radii="300"
          variant="Success"
          fill="Soft"
          disabled={!trimmed || creating}
        >
          <Text size="B300">{t(`${PACKS}.create`)}</Text>
        </Button>
      </Box>
      {failed && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {t('featureUi.settings.emojisStickers.globalPacks.failedToApplyChangesPleaseTryAgain')}
        </Text>
      )}
    </SettingTile>
  );
}

/** The room's emoji and sticker packs, one at a time in the pack view, and a way to add one. */
export function RoomPacksPage({ room, requestClose }: { room: Room; requestClose: () => void }) {
  const { t } = useTranslation();
  const me = useMatrixClient().getSafeUserId();
  const packs = useRoomImagePacks(room);
  const may = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const [viewing, setViewing] = useState<ImagePack>();
  const live = useMemo(() => packs.filter((pack) => !pack.deleted), [packs]);
  const title = t('featureUi.roomSettings.navigation.emojisStickers');

  if (viewing?.address) {
    return <ImagePackView address={viewing.address} requestClose={() => setViewing(undefined)} />;
  }

  return (
    <SettingsPageFrame title={title} requestClose={requestClose}>
      {may.stateEvent(StateEvent.PoniesRoomEmotes, me) && (
        <SettingsCard>
          <NewPackForm room={room} stateKeys={packs.map((pack) => pack.address?.stateKey ?? '')} />
        </SettingsCard>
      )}
      <Box direction="Column" gap="100">
        <Text size="L400">{t(`${PACKS}.packs`)}</Text>
        <SettingsCard>
          {live.length === 0 ? (
            <SettingTile
              title={t(`${PACKS}.noPacks`)}
              description={t(`${PACKS}.thereAreNoEmojiOrStickerPacks`)}
            />
          ) : (
            live.map((pack) => (
              <SettingTile
                key={pack.address?.stateKey ?? pack.id}
                title={pack.meta.name ?? t(`${PACKS}.unknown`)}
                after={
                  <Button
                    size="300"
                    radii="300"
                    variant="Secondary"
                    fill="Soft"
                    onClick={() => setViewing(pack)}
                  >
                    <Text size="B300">{t(`${PACKS}.view`)}</Text>
                  </Button>
                }
              />
            ))
          )}
        </SettingsCard>
      </Box>
    </SettingsPageFrame>
  );
}
