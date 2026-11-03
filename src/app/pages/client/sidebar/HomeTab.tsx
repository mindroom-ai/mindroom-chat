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
import { useHomeSelected } from '../../../hooks/router/useHomeSelected';
import { useNavToActivePathAtom } from '../../../state/hooks/navToActivePath';
import { useRoomsUnread } from '../../../state/hooks/unread';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { MindroomMarkRoomsReadMenuItem } from '../../../mindroom/notifications/MindroomMarkRoomsReadMenuItem';
import { getHomePath, joinPathComponent } from '../../pathUtils';
import { useHomeRooms } from '../home/useHomeRooms';
import { SidebarContextMenu, toggleContextMenu } from './SidebarContextMenu';

type HomeTabProps = {
  /** Lets the navigation panel take the click, given whether Home is shown; true when it did. */
  onSelect?: (selected: boolean) => boolean;
};

/** The Home button of the icon rail; returns to the last place opened in Home. */
export function HomeTab({ onSelect }: HomeTabProps) {






  const unread = useRoomsUnread(homeRooms, roomToUnreadAtom);
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();

  const handleClick = () => {
    if (onSelect?.(homeSelected)) return;
    const lastPath = navToActivePath.get('home');
    // On phones the first tap shows the Home list; a second one returns to the last room.
    if (screenSize === ScreenSize.Mobile && !homeSelected) {
      navigate(getHomePath());
      return;
    }
    navigate(lastPath ? joinPathComponent(lastPath) : getHomePath());
  };

  return (
    <SidebarItem active={homeSelected}>
      <SidebarItemTooltip tooltip={t('nav.home')}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={t('nav.home')}
            onClick={handleClick}
            onContextMenu={toggleContextMenu(setMenuAnchor)}
          >


















