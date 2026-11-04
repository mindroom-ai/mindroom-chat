import React, { useState } from 'react';
import { Icon, Icons } from 'folds';
import type { RectCords } from 'folds';
import { useAtomValue } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
} from '../../../components/sidebar';
import { UnreadBadge } from '../../../components/unread-badge';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { useDirectSelected } from '../../../hooks/router/useDirectSelected';
import { useNavToActivePathAtom } from '../../../state/hooks/navToActivePath';
import { useRoomsUnread } from '../../../state/hooks/unread';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';
import { getDirectPath, joinPathComponent } from '../../pathUtils';
import { useDirectRoomIds } from '../direct/useDirectRooms';
import { SidebarContextMenu, toggleContextMenu } from './SidebarContextMenu';

type DirectTabProps = {
  onSelect?: (selected: boolean) => boolean;
};

/** The Direct Messages button of the icon rail. */
export function DirectTab({ onSelect }: DirectTabProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useScreenSizeContext() === ScreenSize.Mobile;
  const selected = useDirectSelected();
  const navToActivePath = useAtomValue(useNavToActivePathAtom());
  // The conversations Direct Messages lists, so the badge counts none it hides.
  const directRoomIds = useDirectRoomIds();
  const unread = useRoomsUnread(directRoomIds, roomToUnreadAtom);
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const handleClick = () => {
    if (onSelect?.(selected)) return;
    const lastPath = navToActivePath.get('direct');
    if (isMobile && !selected) {
      navigate(getDirectPath());
      return;
    }
    navigate(lastPath ? joinPathComponent(lastPath) : getDirectPath());
  };

  // Direct messages are personal, so any unread one stands out like a mention.
  const unreadBadge = unread ? (
    <SidebarItemBadge hasCount={unread.total > 0}>
      <UnreadBadge dm count={unread.total} highlight={unread.highlight > 0} />
    </SidebarItemBadge>
  ) : null;

  return (
    <SidebarItem active={selected}>
      <SidebarItemTooltip tooltip={t('nav.directMessages')}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={t('nav.directMessages')}
            onClick={handleClick}
            onContextMenu={toggleContextMenu(setMenuAnchor)}
          >
            <Icon filled={selected} src={Icons.User} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
      {unreadBadge}
      <SidebarContextMenu anchor={menuAnchor} onClose={() => setMenuAnchor(undefined)}>
        <MindroomMarkRoomsReadMenuItem
          roomIds={directRoomIds}
          onClose={() => setMenuAnchor(undefined)}
        />
      </SidebarContextMenu>
    </SidebarItem>
  );
}
