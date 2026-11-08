import { useMemo, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import type { Options as FocusTrapOptions } from 'focus-trap';
import {
  Box,
  Button,
  Checkbox,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
  color,
  config,
  toRem,
} from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Header, Modal } from '../../ui/glass/GlassPrimitives';
import { PageScroll } from '../../ui/page/PageScroll';
import { SettingTile } from '../../ui/SettingTile';
import { useAccountData } from '../../matrix/hooks/useAccountData';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomName } from '../../matrix/hooks/useRoomMeta';
import { type EmoteRoomsContent, ImageUsage } from '../custom/types';
import { type ImagePack } from '../custom/ImagePack';
import { getRoomImagePacks } from '../custom/utils';
import { PackAvatar } from '../packs/PackMetaEditor';
import { stopPropagation } from '../../lib/keyboard';
import { AccountDataEvent } from '../../matrix/types/accountData';
import { SettingsCard } from '../../ui/settings/SettingsCard';
import { revealDirectionControls } from '../../ui/directional';

const GLOBAL = 'featureUi.settings.emojisStickers.globalPacks';

/** The pack's avatar, else its first emoji or sticker. */
const packAvatar = (pack: ImagePack): string | undefined =>
  pack.getAvatarUrl(ImageUsage.Emoticon) ?? pack.getAvatarUrl(ImageUsage.Sticker);

/** `roomId` and state key of a pack, as one string. */
const packId = (roomId: string, stateKey: string) => JSON.stringify([roomId, stateKey]);

/** The packs the account uses in every room, as ids, from `im.ponies.emote_rooms`. */
const useChosenPackIds = (): Set<string> => {
  const event = useAccountData(AccountDataEvent.PoniesEmoteRooms);
  return useMemo(() => {
    const rooms = event?.getContent<EmoteRoomsContent>()?.rooms;
    const ids = new Set<string>();
    if (!rooms || typeof rooms !== 'object') return ids;
    Object.entries(rooms).forEach(([roomId, keys]) => {
      if (keys && typeof keys === 'object') {
        Object.keys(keys).forEach((stateKey) => ids.add(packId(roomId, stateKey)));
      }
    });
    return ids;
  }, [event]);
};

/** The joined rooms that hold at least one pack, with those packs. */
const useRoomsWithPacks = (): Array<{ room: Room; packs: ImagePack[] }> => {
  const client = useMatrixClient();
  return client
    .getRooms()
    .filter((room) => room.getMyMembership() === 'join')
    .map((room) => ({ room, packs: getRoomImagePacks(room).filter((pack) => !pack.deleted) }))
    .filter(({ packs }) => packs.length > 0)
    .sort((a, b) => a.room.name.localeCompare(b.room.name));
};

function RoomPackGroup({
  room,
  packs,
  chosen,
  onToggle,
}: {
  room: Room;
  packs: ImagePack[];
  chosen: Set<string>;
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  const name = revealDirectionControls(useRoomName(room));
  return (
    <Box direction="Column" gap="100">
      <Text size="L400" data-settings-heading="">
        {name}
      </Text>
      <SettingsCard>
        {packs.map((pack) => {
          const id = packId(room.roomId, pack.address?.stateKey ?? '');
          const label = pack.meta.name ?? t(`${GLOBAL}.unknown`);
          return (
            <SettingTile
              key={id}
              before={<PackAvatar mxc={packAvatar(pack)} name={label} size="300" />}
              title={label}
              after={
                <Checkbox
                  variant="Success"
                  aria-label={label}
                  checked={chosen.has(id)}
                  // folds' Checkbox types leave out onChange; a click toggles the choice.
                  readOnly
                  onClick={() => onToggle(id)}
                />
              }
            />
          );
        })}
      </SettingsCard>
    </Box>
  );
}

// Escape (kept from the settings dialog underneath) or a click beside the chooser closes it, and
// focus goes back to Select.
const LIGHT_DISMISS = { clickOutsideDeactivates: true, escapeDeactivates: stopPropagation };
const chooserTrap = (close: () => void): FocusTrapOptions => ({
  ...LIGHT_DISMISS,
  initialFocus: false,
  returnFocusOnDeactivate: true,
  onDeactivate: close,
});

/** Picks the room packs to use everywhere; Save writes the choice to the account. */
function RoomPacksChooser({ requestClose }: { requestClose: () => void }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const saved = useChosenPackIds();
  const groups = useRoomsWithPacks();
  const [chosen, setChosen] = useState(() => new Set(saved));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = () => {
    const rooms: Record<string, Record<string, object>> = {};
    chosen.forEach((id) => {
      const [roomId, stateKey] = JSON.parse(id) as [string, string];
      rooms[roomId] = { ...rooms[roomId], [stateKey]: {} };
    });
    setSaving(true);
    setFailed(false);
    client
      .setAccountData(AccountDataEvent.PoniesEmoteRooms as never, { rooms } as never)
      .then(requestClose, () => setFailed(true))
      .finally(() => setSaving(false));
  };

  const title = (
    <Header
      size="500"
      style={{ paddingBlock: 0, paddingInline: `${config.space.S400} ${config.space.S200}` }}
    >
      <Box grow="Yes" style={{ minWidth: 0 }}>
        <Text size="H4" truncate>
          {t(`${GLOBAL}.roomPacks`)}
        </Text>
      </Box>
      <IconButton size="300" radii="300" aria-label={t(`${GLOBAL}.close`)} onClick={requestClose}>
        <Icon src={Icons.Cross} size="100" />
      </IconButton>
    </Header>
  );

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap focusTrapOptions={chooserTrap(requestClose)}>
          <Modal
            size="300"
            flexHeight
            role="dialog"
            aria-label={t(`${GLOBAL}.roomPacks`)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: `min(calc(100vw - 2 * ${config.space.S400}), ${toRem(480)})`,
              maxHeight: `calc(100dvh - 2 * ${config.space.S400})`,
            }}
          >
            <PageScroll header={title}>
              <Box direction="Column" gap="500" style={{ padding: config.space.S400 }}>
                {groups.length === 0 ? (
                  <SettingTile
                    title={t(`${GLOBAL}.noPacks`)}
                    description={t(`${GLOBAL}.packFromRoomsWillAppearHereYou`)}
                  />
                ) : (
                  groups.map(({ room, packs }) => (
                    <RoomPackGroup
                      key={room.roomId}
                      room={room}
                      packs={packs}
                      chosen={chosen}
                      onToggle={toggle}
                    />
                  ))
                )}
              </Box>
            </PageScroll>
            <Box
              shrink="No"
              gap="200"
              alignItems="Center"
              justifyContent="End"
              style={{ padding: config.space.S400, paddingTop: config.space.S200 }}
            >
              {failed && (
                <Text size="T200" role="alert" style={{ color: color.Critical.Main, flexGrow: 1 }}>
                  {t(`${GLOBAL}.failedToApplyChangesPleaseTryAgain`)}
                </Text>
              )}
              <Button
                size="300"
                radii="300"
                variant="Success"
                disabled={saving || groups.length === 0}
                onClick={save}
              >
                <Text size="B300">{t(`${GLOBAL}.save`)}</Text>
              </Button>
            </Box>
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

/** The room packs the account uses in every room, and the dialog that picks them. */
export function GlobalPacks({ onViewPack }: { onViewPack: (pack: ImagePack) => void }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const chosen = useChosenPackIds();
  const [choosing, setChoosing] = useState(false);
  const favorites = useMemo(
    () =>
      [...chosen].flatMap((id) => {
        const [roomId, stateKey] = JSON.parse(id) as [string, string];
        const room = client.getRoom(roomId);
        const pack = room
          ? getRoomImagePacks(room).find((item) => item.address?.stateKey === stateKey)
          : undefined;
        return pack && !pack.deleted ? [pack] : [];
      }),
    [chosen, client]
  );

  return (
    <Box direction="Column" gap="100">
      <Text size="L400" data-settings-heading="">
        {t(`${GLOBAL}.favoritePacks`)}
      </Text>
      <SettingsCard>
        <SettingTile
          focusId="favoritePacks"
          title={t(`${GLOBAL}.selectPack`)}
          description={t(`${GLOBAL}.pickEmojisAndStickersPackFromRooms`)}
          after={
            <Button
              size="300"
              radii="300"
              variant="Secondary"
              fill="Soft"
              onClick={() => setChoosing(true)}
            >
              <Text size="B300">{t(`${GLOBAL}.select`)}</Text>
            </Button>
          }
        />
        {favorites.map((pack) => (
          <SettingTile
            focusId="favoritePacks"
            key={pack.id}
            before={<PackAvatar mxc={packAvatar(pack)} name={pack.meta.name ?? ''} size="300" />}
            title={pack.meta.name ?? t(`${GLOBAL}.unknown`)}
            after={
              <Button
                size="300"
                radii="300"
                variant="Secondary"
                fill="Soft"
                onClick={() => onViewPack(pack)}
              >
                <Text size="B300">{t(`${GLOBAL}.view`)}</Text>
              </Button>
            }
          />
        ))}
      </SettingsCard>
      {choosing && <RoomPacksChooser requestClose={() => setChoosing(false)} />}
    </Box>
  );
}
