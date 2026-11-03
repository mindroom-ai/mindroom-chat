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




  const unread = useRoomUnread(space.roomId, roomToUnreadAtom);
  const avatarUrl = getRoomAvatarUrl(mx, space, 96, useAuthentication);
  const spaceRooms = useSpaceSearchRooms(space.roomId);
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const handleClick = () => {
    const lastPath = navToActivePath.get(space.roomId);
    navigate(
      lastPath
        ? joinPathComponent(lastPath)
        : getSpacePath(getCanonicalAliasOrRoomId(mx, space.roomId))
    );
  };

  const unreadBadge = unread ? (
    <SidebarItemBadge hasCount={unread.total > 0}>
      <UnreadBadge count={unread.total} highlight={unread.highlight > 0} />
    </SidebarItemBadge>
  ) : null;

  return (
    <SidebarItem active={selected}>
      <SidebarItemTooltip tooltip={space.name}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            size="400"
            aria-label={space.name}
            onClick={handleClick}
            onContextMenu={toggleContextMenu(setMenuAnchor)}
          >
            <RoomAvatar



              renderFallback={() => <Text size="H4">{nameInitials(space.name, 2)}</Text>}
            />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
      {unreadBadge}
      <SidebarContextMenu anchor={menuAnchor} onClose={() => setMenuAnchor(undefined)}>
        <MindroomMarkRoomsReadMenuItem
          roomIds={spaceRooms}
          onClose={() => setMenuAnchor(undefined)}
        />
      </SidebarContextMenu>
    </SidebarItem>
  );
}

/** The joined top-level spaces in the icon rail. */
export function SpaceTabs() {






  const spaces = useMemo(
    () =>
      rooms
        .map((roomId) => mx.getRoom(roomId))
        .filter((room): room is Room => !!room && isSpace(room))
        .filter((room) => (roomToParents.get(room.roomId)?.size ?? 0) === 0),
    [mx, rooms, roomToParents]
  );

  if (spaces.length === 0) return null;

  return (
    <div role="group" aria-label={t('sharedUi.roomTypes.spaces')}>
      {spaces.map((space) => (
        <SpaceTab key={space.roomId} space={space} selected={selectedSpaceId === space.roomId} />
      ))}
    </div>
  );
}
