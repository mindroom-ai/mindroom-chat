import React, { MouseEventHandler, useState } from 'react';
import { Box, Icon, Icons, PopOut, Text, config, toRem } from 'folds';
import { Menu, MenuItem } from '../../../components/glass/GlassPrimitives';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
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
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { useHomeSelected } from '../../../hooks/router/useHomeSelected';
import { useNavToActivePathAtom } from '../../../state/hooks/navToActivePath';
import { useRoomsUnread } from '../../../state/hooks/unread';
import { roomToUnreadAtom } from '../../../state/room/roomToUnread';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';
import { stopPropagation } from '../../../utils/keyboard';
import { markRoomAndThreadsAsRead } from '../../../mindroom/notifications/readReceipts';
import { getHomePath, joinPathComponent } from '../../pathUtils';
import { useHomeRooms } from '../home/useHomeRooms';

type HomeTabProps = {
  /** Lets the navigation panel take the click, given whether Home is shown; true when it did. */
  onSelect?: (selected: boolean) => boolean;
};

function HomeTabMenu({ roomIds, requestClose }: { roomIds: string[]; requestClose: () => void }) {



  return (






          disabled={roomIds.length === 0}
          onClick={() => {
            roomIds.forEach((roomId) => markRoomAndThreadsAsRead(mx, roomId, hideActivity));
            requestClose();
          }}
        >
          <Text as="span" size="T300" truncate>
            {t('featureUi.sidebar.markAsRead')}
          </Text>
        </MenuItem>
      </Box>
    </Menu>
  );
}

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

  const handleContextMenu: MouseEventHandler<HTMLButtonElement> = (event) => {
    event.preventDefault();
    const cords = event.currentTarget.getBoundingClientRect();
    setMenuAnchor((current) => (current ? undefined : cords));
  };

  return (
    <SidebarItem active={homeSelected}>
      <SidebarItemTooltip tooltip={t('featureUi.sidebar.home')}>
        {(triggerRef) => (
          <SidebarAvatar
            as="button"
            ref={triggerRef}
            outlined
            aria-label={t('featureUi.sidebar.home')}






























            </FocusTrap>
          }
        />
      )}
    </SidebarItem>
  );
}
