import { type MouseEvent, useMemo, useState } from 'react';
import { Box, Chip, Icon, Icons, Text, config, toRem } from 'folds';
import type { RectCords } from 'folds';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { KnownMembership, type MatrixClient, type Room } from 'matrix-js-sdk';
import { MenuItem } from '../../ui/glass/GlassPrimitives';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { isSpace } from '../../matrix/room';
import { revealDirectionControls } from '../../ui/directional';
import { ProfilePopMenu } from './ProfilePopMenu';

const KEY = 'sharedUi.userChips';
const LIST_STYLE = { maxHeight: toRem(320), overflowY: 'auto' as const, minWidth: toRem(220) };

type Shared = { spaces: Room[]; rooms: Room[]; directs: Room[] };

/** The joined rooms `userId` is also joined to, as spaces, rooms and direct messages. */
const getMutualRooms = (
  client: MatrixClient,
  roomIds: string[],
  directIds: Set<string>,
  userId: string
): Shared => {
  const shared: Shared = { spaces: [], rooms: [], directs: [] };
  roomIds.forEach((roomId) => {
    const room = client.getRoom(roomId);
    if (room?.getMember(userId)?.membership !== KnownMembership.Join) return;
    if (isSpace(room)) shared.spaces.push(room);
    else if (directIds.has(roomId)) shared.directs.push(room);
    else shared.rooms.push(room);
  });
  const byName = (a: Room, b: Room) => a.name.localeCompare(b.name);
  return {
    spaces: shared.spaces.sort(byName),
    rooms: shared.rooms.sort(byName),
    directs: shared.directs.sort(byName),
  };
};

/**
 * How many joined rooms the person shares with the user; the chip opens them by kind, and a
 * row opens that room. Computed from the rooms this client has, so it needs no server support.
 */
export function MutualRoomsChip({ userId, onOpen }: { userId: string; onOpen: () => void }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const { navigateRoom, navigateSpace } = useRoomNavigate();
  const roomIds = useAtomValue(allRoomsAtom);
  const directIds = useAtomValue(mDirectAtom);
  const [anchor, setAnchor] = useState<RectCords>();
  const shared = useMemo(
    () => getMutualRooms(client, roomIds, directIds, userId),
    [client, roomIds, directIds, userId]
  );
  const count = shared.spaces.length + shared.rooms.length + shared.directs.length;
  if (count === 0) return null;

  const close = () => setAnchor(undefined);
  const open = (room: Room) => {
    close();
    onOpen();
    if (isSpace(room)) navigateSpace(room.roomId);
    else navigateRoom(room.roomId);
  };

  const group = (label: string, rooms: Room[]) =>
    rooms.length > 0 && (
      <Box key={label} direction="Column" gap="100">
        <Text size="L400" style={{ padding: `${config.space.S100} ${config.space.S200}` }}>
          {label}
        </Text>
        {rooms.map((room) => (
          <MenuItem
            key={room.roomId}
            size="300"
            radii="300"
            role="menuitem"
            onClick={() => open(room)}
          >
            <Text size="T300" truncate>
              {revealDirectionControls(room.name)}
            </Text>
          </MenuItem>
        ))}
      </Box>
    );

  const trigger = (
    <Chip
      variant="SurfaceVariant"
      radii="Pill"
      aria-haspopup="menu"
      aria-expanded={Boolean(anchor)}
      before={<Icon size="50" src={Icons.Category} />}
      onClick={(event: MouseEvent<HTMLButtonElement>) =>
        setAnchor(event.currentTarget.getBoundingClientRect())
      }
    >
      <Text size="B300">{t(`${KEY}.mutualRooms`, { count })}</Text>
    </Chip>
  );

  return (
    <ProfilePopMenu
      at={anchor}
      onClose={close}
      label={t(`${KEY}.mutualRooms`)}
      trigger={trigger}
      menuStyle={LIST_STYLE}
    >
      <Box direction="Column" gap="200" style={{ padding: config.space.S100 }}>
        {group(t(`${KEY}.spaces`), shared.spaces)}
        {group(t(`${KEY}.rooms`), shared.rooms)}
        {group(t(`${KEY}.directMessages`), shared.directs)}
      </Box>
    </ProfilePopMenu>
  );
}
