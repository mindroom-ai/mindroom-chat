import React, { type FormEvent, useMemo, useState } from 'react';
import { Box, Button, Icon, Icons, Input, Spinner, Text, color, config } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { IconButton } from '../../ui/glass/GlassPrimitives';
import { ImagePackView } from '../../emoji/packs/ImagePackView';
import { PackAvatar } from '../../emoji/packs/PackMetaEditor';
import { SettingTile } from '../../ui/SettingTile';
import { useAlive } from '../../lib/hooks/useAlive';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomImagePacks } from '../../emoji/useImagePacks';
import { usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import { ImageUsage, type PackAddress } from '../../emoji/custom/types';
import { type ImagePack } from '../../emoji/custom/ImagePack';
import { nextPackStateKey } from '../../emoji/custom/utils';
import { StateEvent } from '../../matrix/types/room';
import { SettingsCard } from '../../ui/settings/SettingsCard';
import { SettingsPageFrame } from '../../ui/settings/SettingsPageFrame';

const PACKS = 'featureUi.commonSettings.emojisStickers.roomPacks';

/**
 * The state key for a new pack: the empty key while the room has no live pack under it (the
 * pack other clients open first), else the next free number.
 */
const newPackStateKey = (liveKeys: string[]): string =>
  liveKeys.includes('') ? nextPackStateKey(liveKeys) : '';

/** A name field and Create, for those who may add packs to the room; opens the new pack. */
function NewPackForm({
  room,
  liveKeys,
  onCreated,
}: {
  room: Room;
  liveKeys: string[];
  onCreated: (address: PackAddress) => void;
}) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);
  const trimmed = name.trim();

  const create = (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    if (!trimmed || creating) return;
    const stateKey = newPackStateKey(liveKeys);
    setCreating(true);
    setFailed(false);
    client
      .sendStateEvent(
        room.roomId,
        StateEvent.PoniesRoomEmotes as never,
        { pack: { display_name: trimmed }, images: {} } as never,
        stateKey
      )
      .then(
        () => {
          if (!alive()) return;
          setName('');
          onCreated({ roomId: room.roomId, stateKey });
        },
        () => alive() && setFailed(true)
      )
      .finally(() => alive() && setCreating(false));
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

type PackTileProps = {
  pack: ImagePack;
  canEdit: boolean;
  marked: boolean;
  onView: () => void;
  onToggleMark: () => void;
};

/** One pack: avatar, name and image count, View, and for editors a way to mark it for deletion. */
function PackTile({ pack, canEdit, marked, onView, onToggleMark }: PackTileProps) {
  const { t } = useTranslation();
  const name = pack.meta.name ?? t(`${PACKS}.unknown`);
  const avatar = pack.getAvatarUrl(ImageUsage.Emoticon) ?? pack.getAvatarUrl(ImageUsage.Sticker);
  return (
    <SettingTile
      before={
        <Box style={{ opacity: marked ? 0.5 : 1 }}>
          <PackAvatar mxc={avatar} name={name} size="300" />
        </Box>
      }
      title={<span style={marked ? { textDecoration: 'line-through' } : undefined}>{name}</span>}
      after={
        <Box gap="200" alignItems="Center">
          {!marked && (
            <Button size="300" radii="300" variant="Secondary" fill="Soft" onClick={onView}>
              <Text size="B300">{t(`${PACKS}.view`)}</Text>
            </Button>
          )}
          {canEdit &&
            (marked ? (
              <Button size="300" radii="300" variant="Secondary" fill="Soft" onClick={onToggleMark}>
                <Text size="B300">{t('sharedUi.imageTile.undo')}</Text>
              </Button>
            ) : (
              <IconButton
                size="300"
                radii="300"
                variant="Critical"
                aria-label={t(`${PACKS}.deletePack`, { name })}
                title={t(`${PACKS}.delete`)}
                onClick={onToggleMark}
              >
                <Icon size="50" src={Icons.Delete} />
              </IconButton>
            ))}
        </Box>
      }
    />
  );
}

// A critical tinted bar, like the pack view's warning bar for pending edits. Built on use, so the
// theme variables are read once the app has loaded them.
const confirmBarStyle = (): React.CSSProperties => {
  const tint = color.Critical;
  return {
    background: tint.Container,
    color: tint.OnContainer,
    border: `${config.borderWidth.B300} solid ${tint.ContainerLine}`,
    borderRadius: config.radii.R400,
    paddingBlock: config.space.S200,
    paddingInline: config.space.S300,
  };
};

/** The bar that asks to confirm deleting the marked packs. */
function DeletePacksBar({
  count,
  deleting,
  failed,
  onCancel,
  onDelete,
}: {
  count: number;
  deleting: boolean;
  failed: boolean;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Box direction="Column" gap="200" style={confirmBarStyle()}>
      <Box alignItems="Center" gap="200" wrap="Wrap">
        <Box grow="Yes">
          <Text size="T300">{t(`${PACKS}.deleteSelectedPacks`, { count })}</Text>
        </Box>
        <Box gap="200">
          <Button
            size="300"
            radii="300"
            variant="Secondary"
            fill="Soft"
            disabled={deleting}
            onClick={onCancel}
          >
            <Text size="B300">{t(`${PACKS}.cancel`)}</Text>
          </Button>
          <Button
            size="300"
            radii="300"
            variant="Critical"
            disabled={deleting}
            before={deleting ? <Spinner size="100" variant="Critical" fill="Solid" /> : undefined}
            onClick={onDelete}
          >
            <Text size="B300">{t(`${PACKS}.delete`)}</Text>
          </Button>
        </Box>
      </Box>
      {failed && (
        <Text size="T200" role="alert">
          {t(`${PACKS}.failedToRemovePacksPleaseTryAgain`)}
        </Text>
      )}
    </Box>
  );
}

/**
 * The room's emoji and sticker packs: create one, open one in the pack view, or delete some. A
 * deleted pack keeps its state event with empty content, which every client reads as no pack.
 */
export function RoomPacksPage({ room, requestClose }: { room: Room; requestClose: () => void }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const me = client.getSafeUserId();
  const packs = useRoomImagePacks(room);
  const may = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const canEdit = may.stateEvent(StateEvent.PoniesRoomEmotes, me);
  const [viewing, setViewing] = useState<PackAddress>();
  const [marked, setMarked] = useState<ReadonlySet<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const live = useMemo(() => packs.filter((pack) => !pack.deleted), [packs]);
  const liveKeys = useMemo(() => live.map((pack) => pack.address?.stateKey ?? ''), [live]);
  const title = t('featureUi.roomSettings.navigation.emojisStickers');
  // Marks of packs that are gone (deleted elsewhere) no longer count.
  const markedKeys = liveKeys.filter((key) => marked.has(key));

  if (viewing) {
    return <ImagePackView address={viewing} requestClose={() => setViewing(undefined)} />;
  }

  const toggleMark = (stateKey: string) =>
    setMarked((previous) => {
      const next = new Set(previous);
      if (next.has(stateKey)) next.delete(stateKey);
      else next.add(stateKey);
      return next;
    });

  const deleteMarked = () => {
    setDeleting(true);
    setDeleteFailed(false);
    Promise.all(
      markedKeys.map((stateKey) =>
        client.sendStateEvent(
          room.roomId,
          StateEvent.PoniesRoomEmotes as never,
          {} as never,
          stateKey
        )
      )
    )
      .then(
        () => alive() && setMarked(new Set()),
        () => alive() && setDeleteFailed(true)
      )
      .finally(() => alive() && setDeleting(false));
  };

  return (
    <SettingsPageFrame title={title} requestClose={requestClose}>
      {canEdit && (
        <SettingsCard>
          <NewPackForm room={room} liveKeys={liveKeys} onCreated={setViewing} />
        </SettingsCard>
      )}
      <Box direction="Column" gap="100">
        <Text size="L400" data-settings-heading="">
          {t(`${PACKS}.packs`)}
        </Text>
        <Box direction="Column" gap="200">
          {markedKeys.length > 0 && (
            <DeletePacksBar
              count={markedKeys.length}
              deleting={deleting}
              failed={deleteFailed}
              onCancel={() => setMarked(new Set())}
              onDelete={deleteMarked}
            />
          )}
          <SettingsCard>
            {live.length === 0 ? (
              <SettingTile
                title={t(`${PACKS}.noPacks`)}
                description={t(`${PACKS}.thereAreNoEmojiOrStickerPacks`)}
              />
            ) : (
              live.map((pack) => {
                const stateKey = pack.address?.stateKey ?? '';
                return (
                  <PackTile
                    key={stateKey}
                    pack={pack}
                    canEdit={canEdit}
                    marked={marked.has(stateKey)}
                    onView={() => setViewing({ roomId: room.roomId, stateKey })}
                    onToggleMark={() => toggleMark(stateKey)}
                  />
                );
              })
            )}
          </SettingsCard>
        </Box>
      </Box>
    </SettingsPageFrame>
  );
}
