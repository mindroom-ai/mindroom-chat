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
import { mDirectAtom } from '../../../state/mDirectList';
import { useRoomsUnread } from '../../../state/hooks/unread';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';
import { getDirectPath, joinPathComponent } from '../../pathUtils';
import { SidebarContextMenu, toggleContextMenu } from './SidebarContextMenu';

type DirectTabProps = {
  onSelect?: (selected: boolean) => boolean;
};

/** The Direct Messages button of the icon rail. */
export function DirectTab({ onSelect }: DirectTabProps) {



  const selected = useDirectSelected();
  const navToActivePath = useAtomValue(useNavToActivePathAtom());
  const directs = useAtomValue(mDirectAtom);
  const directRoomIds = Array.from(directs);
  const unread = useRoomsUnread(directRoomIds, roomToUnreadAtom);
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const handleClick = () => {
    if (onSelect?.(selected)) return;
    const lastPath = navToActivePath.get('direct');
    if (screenSize === ScreenSize.Mobile && !selected) {
      navigate(getDirectPath());
      return;
    }
    navigate(lastPath ? joinPathComponent(lastPath) : getDirectPath());
  };

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












          onClose={() => setMenuAnchor(undefined)}
        />
      </SidebarContextMenu>
    </SidebarItem>
  );
}
