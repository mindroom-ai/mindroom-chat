import React, { useMemo, useState } from 'react';
import { Icon, Icons, Text } from 'folds';
import type { RectCords } from 'folds';
import { useAtomValue } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
  SidebarStack,
  SidebarStackSeparator,
} from '../../../components/sidebar';
import { RoomAvatar } from '../../../components/room-avatar';
import { UnreadBadge } from '../../../components/unread-badge';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../../hooks/useMediaAuthentication';
import { useSelectedSpace } from '../../../hooks/router/useSelectedSpace';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { usePowerLevels } from '../../../hooks/usePowerLevels';
import { useRoomCreators } from '../../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../../hooks/useRoomPermissions';
import { InviteUserPrompt } from '../../../components/invite-user-prompt';
import { MenuItem } from '../../../components/glass/GlassPrimitives';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { useRoomUnread } from '../../../state/hooks/unread';
import { useNavToActivePathAtom } from '../../../state/hooks/navToActivePath';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { getRoomAvatarUrl, isSpace } from '../../../utils/room';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';
import { getSpacePath, joinPathComponent } from '../../pathUtils';
import { useSpaceSearchRooms } from '../space/useSpaceSearchRooms';
import { SidebarContextMenu, toggleContextMenu } from './SidebarContextMenu';

const menuLabelStyle = { flexGrow: 1 } as const;

/** "Invite" in a space's rail menu, for members allowed to invite. */
function InviteToSpaceItem({ space, onSelect }: { space: Room; onSelect: () => void }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const permissions = useRoomPermissions(useRoomCreators(space), usePowerLevels(space));
  if (!permissions.action('invite', client.getUserId() ?? '')) return null;
  return (
    <MenuItem
      size="300"
      radii="300"
      after={<Icon size="100" src={Icons.UserPlus} />}
      onClick={onSelect}
    >
      <Text as="span" size="T300" align="Left" truncate style={menuLabelStyle}>
        {t('sharedUi.spaceTabs.invite')}
      </Text>
    </MenuItem>
  );
}

type SpaceTabProps = {
  space: Room;
  selected: boolean;
  /** Lets the navigation panel take the click, given whether the space is shown; true when it did. */
  onSelect?: (selected: boolean) => boolean;
};

function SpaceTab({ space, selected, onSelect }: SpaceTabProps) {
  const client = useMatrixClient();
  const { roomId, name } = space;
  const navigate = useNavigate();
  const isMobile = useScreenSizeContext() === ScreenSize.Mobile;
  const useAuthentication = useMediaAuthentication();
  const activePaths = useAtomValue(useNavToActivePathAtom());
  const unread = useRoomUnread(roomId, roomToUnreadAtom);
  const avatarUrl = getRoomAvatarUrl(client, space, 96, useAuthentication);
  const spaceRooms = useSpaceSearchRooms(roomId);
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const [inviting, setInviting] = useState(false);

  const closeMenu = () => setMenuAnchor(undefined);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // A click another handler already claimed changes nothing here.
    if (event.defaultPrevented) return;
    if (onSelect?.(selected)) return;
    const spacePath = getSpacePath(getCanonicalAliasOrRoomId(client, roomId));
    // On phones the first tap shows the space's list; a second one returns to its last room.
    if (isMobile && !selected) {
      navigate(spacePath);
      return;
    }
    const lastPath = activePaths.get(roomId);
    navigate(lastPath ? joinPathComponent(lastPath) : spacePath);
  };

  const unreadBadge = unread ? (
    <SidebarItemBadge hasCount={unread.total > 0}>
      <UnreadBadge count={unread.total} highlight={unread.highlight > 0} />
    </SidebarItemBadge>
  ) : null;

  return (
    <SidebarItem active={selected}>
      <SidebarItemTooltip tooltip={name}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            size="400"
            data-id={roomId}
            onClick={handleClick}
            onContextMenu={toggleContextMenu(setMenuAnchor)}
          >
            <RoomAvatar




                // Its first two letters as written ("Mi" for MindRoom), not two words' initials.
                <Text size="H4">{Array.from(name.trim()).slice(0, 2).join('')}</Text>
              )}
            />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
      {unreadBadge}
      <SidebarContextMenu anchor={menuAnchor} onClose={closeMenu}>
        <MindroomMarkRoomsReadMenuItem roomIds={spaceRooms} onClose={closeMenu} />
        <InviteToSpaceItem
          space={space}
          onSelect={() => {
            closeMenu();
            setInviting(true);
          }}
        />
      </SidebarContextMenu>
      {inviting && <InviteUserPrompt room={space} requestClose={() => setInviting(false)} />}
    </SidebarItem>
  );
}

type SpaceTabsProps = {
  /** Passed to each space's button; see `SpaceTabProps.onSelect`. */
  onSelect?: (selected: boolean) => boolean;
};

/** The joined top-level spaces in the icon rail. */
export function SpaceTabs({ onSelect }: SpaceTabsProps = {}) {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const parentsByRoom = useAtomValue(roomToParentsAtom);
  const selectedSpaceId = useSelectedSpace();

  const spaces = useMemo(
    () =>
      joinedRoomIds
        .map((roomId) => client.getRoom(roomId))
        .filter((room): room is Room => !!room && isSpace(room))
        .filter((room) => (parentsByRoom.get(room.roomId)?.size ?? 0) === 0),
    [client, joinedRoomIds, parentsByRoom]
  );

  if (spaces.length === 0) return null;

  // Spaces get their own stack under a rule, apart from the sections above them.
  return (
    <>
      <SidebarStackSeparator />
      <SidebarStack role="group" aria-label={t('sharedUi.roomTypes.spaces')}>
        {spaces.map((space) => (
          <SpaceTab
            key={space.roomId}
            space={space}
            selected={selectedSpaceId === space.roomId}
            onSelect={onSelect}
          />
        ))}
      </SidebarStack>
    </>
  );
}
