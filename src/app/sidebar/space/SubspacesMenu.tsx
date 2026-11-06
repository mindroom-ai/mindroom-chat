import { type MouseEvent, useState } from 'react';
import { Avatar, Box, Icon, Icons, Text, type RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import isHotkey from 'is-hotkey';
import { useAtomValue } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { PopOut, ownDirectionLine } from '../../ui/directional';
import { Menu, MenuItem } from '../../ui/glass/GlassPrimitives';
import { NavButton, NavItem, NavItemContent } from '../../ui/nav/NavItem';
import { UnreadBadge, UnreadBadgeCenter } from '../../ui/UnreadBadge';
import { RoomAvatar, RoomIcon } from '../../avatars/RoomAvatar';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useRoomAvatar, useRoomName } from '../../matrix/hooks/useRoomMeta';
import { getCanonicalAliasOrRoomId, mxcUrlToHttp } from '../../matrix/matrix';
import { navigationRoomToUnreadAtom } from '../../notifications/navigationUnread';
import { stopPropagation } from '../../lib/keyboard';
import { getSpacePath } from '../../routes/pathUtils';

const AVATAR_SIZE = 64;

type SubspaceEntryProps = {
  room: Room;
  /** Whether the sub-space has unread messages, and whether any mention the person. */
  unread?: { highlight: boolean };
  onSelect: () => void;
};

/** One sub-space in the menu: its avatar, its name, and a dot while it has unread messages. */
function SubspaceEntry({ room, unread, onSelect }: SubspaceEntryProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const authenticated = useMediaAuthentication();
  const name = useRoomName(room);
  const avatarMxc = useRoomAvatar(room);
  const src = avatarMxc
    ? mxcUrlToHttp(client, avatarMxc, authenticated, AVATAR_SIZE, AVATAR_SIZE, 'crop') ?? undefined
    : undefined;
  // Without a picture, the space's icon for its join rule.
  const spaceIcon = () => <RoomIcon size="100" space joinRule={room.getJoinRule()} />;
  return (
    <MenuItem
      role="menuitem"
      size="300"
      radii="300"
      variant="Surface"
      aria-label={unread ? t('featureUi.spaceNav.subspaceUnread', { name }) : undefined}
      before={
        <Avatar size="200" radii="300">
          <RoomAvatar roomId={room.roomId} src={src} alt={name} renderFallback={spaceIcon} />
        </Avatar>
      }
      after={
        unread && (
          <UnreadBadgeCenter>
            <span data-unread>
              <UnreadBadge count={0} highlight={unread.highlight} />
            </span>
          </UnreadBadgeCenter>
        )
      }
      onClick={onSelect}
    >
      <Text size="T300" truncate style={{ flexGrow: 1, textAlign: 'start' }} {...ownDirectionLine}>
        {name}
      </Text>
    </MenuItem>
  );
}

const arrowKey = (name: 'arrowdown' | 'arrowup') => (event: KeyboardEvent) => isHotkey(name, event);

/**
 * A row near the top of a space's room list that opens a menu of the space's sub-spaces; choosing
 * one opens the sub-space's own room list (its lobby beside it on wide screens). The row shows a
 * dot while any sub-space has unread messages.
 */
export function SubspacesMenu({ subspaceIds }: { subspaceIds: string[] }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const navigate = useNavigate();
  const unreads = useAtomValue(navigationRoomToUnreadAtom);
  const [anchor, setAnchor] = useState<RectCords>();
  const close = () => setAnchor(undefined);
  const open = (event: MouseEvent<HTMLButtonElement>) =>
    setAnchor(event.currentTarget.getBoundingClientRect());

  const rooms = subspaceIds.flatMap((roomId) => client.getRoom(roomId) ?? []);
  const unreadOf = (roomId: string) => {
    const unread = unreads.get(roomId);
    return unread ? { highlight: unread.highlight > 0 } : undefined;
  };
  const anyUnread = rooms.map((room) => unreadOf(room.roomId)).filter(Boolean);
  const label = t('featureUi.spaceNav.subspaces');

  const menu = (
    <FocusTrap
      focusTrapOptions={{
        onDeactivate: close,
        isKeyBackward: arrowKey('arrowup'),
        isKeyForward: arrowKey('arrowdown'),
        escapeDeactivates: stopPropagation,
        clickOutsideDeactivates: true,
      }}
    >
      <Menu role="menu" aria-label={label} style={{ width: '100vw', maxWidth: 280 }}>
        <Box direction="Column" gap="100" style={{ padding: 4 }}>
          {rooms.map((room) => (
            <SubspaceEntry
              key={room.roomId}
              room={room}
              unread={unreadOf(room.roomId)}
              onSelect={() => {
                close();
                navigate(getSpacePath(getCanonicalAliasOrRoomId(client, room.roomId)));
              }}
            />
          ))}
        </Box>
      </Menu>
    </FocusTrap>
  );

  return (
    <NavItem radii="400" variant="Background">
      <NavButton
        onClick={open}
        aria-haspopup="menu"
        aria-expanded={anchor !== undefined}
        data-subspaces-menu
      >
        <NavItemContent>
          <Box as="span" alignItems="Center" gap="200" grow="Yes">
            <Avatar radii="400" size="200">
              <Icon size="100" src={Icons.Category} />
            </Avatar>
            <Text as="span" size="Inherit" truncate style={{ flexGrow: 1 }}>
              {label}
            </Text>
            {anyUnread.length > 0 && (
              <UnreadBadgeCenter>
                <UnreadBadge count={0} highlight={anyUnread.some((unread) => unread?.highlight)} />
              </UnreadBadgeCenter>
            )}
          </Box>
        </NavItemContent>
      </NavButton>
      <PopOut anchor={anchor} position="Bottom" align="Start" offset={4} content={menu} />
    </NavItem>
  );
}
