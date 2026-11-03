import React, { useMemo, useState } from 'react';
import { Text } from 'folds';
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
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { roomToParentsAtom } from '../../../state/room/roomToParents';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { useRoomUnread } from '../../../state/hooks/unread';
import { useNavToActivePathAtom } from '../../../state/hooks/navToActivePath';
import { getCanonicalAliasOrRoomId } from '../../../utils/matrix';
import { getRoomAvatarUrl, isSpace } from '../../../utils/room';
import { nameInitials } from '../../../utils/common';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';
import { getSpacePath, joinPathComponent } from '../../pathUtils';
import { useSpaceSearchRooms } from '../space/useSpaceSearchRooms';
import { SidebarContextMenu, toggleContextMenu } from './SidebarContextMenu';

function SpaceTab({ space, selected }: { space: Room; selected: boolean }) {
  const client = useMatrixClient();
  const { roomId, name } = space;
  const navigate = useNavigate();
  const useAuthentication = useMediaAuthentication();
  const activePaths = useAtomValue(useNavToActivePathAtom());
  const unread = useRoomUnread(roomId, roomToUnreadAtom);
  const avatarUrl = getRoomAvatarUrl(client, space, 96, useAuthentication);
  const spaceRooms = useSpaceSearchRooms(roomId);
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const closeMenu = () => setMenuAnchor(undefined);

  const handleClick = () => {
    const lastPath = activePaths.get(roomId);
    navigate(
      lastPath
        ? joinPathComponent(lastPath)
        : getSpacePath(getCanonicalAliasOrRoomId(client, roomId))
    );
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
            aria-label={name}
            onClick={handleClick}
            onContextMenu={toggleContextMenu(setMenuAnchor)}
          >
            <RoomAvatar
              alt={name}
              roomId={roomId}
              src={avatarUrl}
              renderFallback={() => <Text size="H4">{nameInitials(name, 2)}</Text>}
            />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
      {unreadBadge}
      <SidebarContextMenu anchor={menuAnchor} onClose={closeMenu}>
        <MindroomMarkRoomsReadMenuItem roomIds={spaceRooms} onClose={closeMenu} />
      </SidebarContextMenu>
    </SidebarItem>
  );
}

/** The joined top-level spaces in the icon rail. */
export function SpaceTabs() {
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
          <SpaceTab key={space.roomId} space={space} selected={selectedSpaceId === space.roomId} />
        ))}
      </SidebarStack>
    </>
  );
}
