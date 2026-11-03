import React, { useState } from 'react';
import { Avatar, Box, Icon, IconButton, Icons, PopOut, Text, config, toRem } from 'folds';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { useFocusWithin, useHover } from 'react-aria';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { NavItem, NavItemContent, NavItemOptions, NavLink } from '../../components/nav';
import { RoomAvatar, RoomIcon } from '../../components/room-avatar';
import { UnreadBadge } from '../../components/unread-badge';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRoomAvatar, useRoomName } from '../../hooks/useRoomMeta';
import { RoomNotificationMode } from '../../hooks/useRoomsNotificationPreferences';
import { useRoomUnread } from '../../state/hooks/unread';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { useOpenRoomSettings } from '../../state/hooks/roomSettings';
import { getCanonicalAliasOrRoomId, mxcUrlToHttp } from '../../utils/matrix';
import { getRoomAvatarUrl } from '../../utils/room';
import { copyToClipboard } from '../../utils/dom';
import { getMatrixToRoom } from '../../plugins/matrix-to';
import { useRoomBackgroundJobs } from '../../mindroom/background-jobs/useRoomBackgroundJobs';
import { IconTooltip } from '../../mindroom/tooltip/IconTooltip';
import { MindroomMarkRoomReadMenuItem } from '../../mindroom/notifications/MindroomMarkRoomReadMenuItem';

const AVATAR_SIZE = 96;






  /** A direct message: shows the other person's avatar with initials as fallback. */
  direct?: boolean;
  showAvatar?: boolean;
};

function RoomNavItemMenu({ room, requestClose }: { room: Room; requestClose: () => void }) {





    void copyToClipboard(getMatrixToRoom(getCanonicalAliasOrRoomId(mx, room.roomId)));
    requestClose();
  };

  const handleLeave = () => {
    void mx.leave(room.roomId);
    requestClose();
  };

  return (




























































































  return (
    <Avatar size="200" radii="400">
      <RoomAvatar roomId={room.roomId} src={src} alt={name} renderFallback={renderFallback} />
    </Avatar>
  );
}

type RoomNavOptionsProps = {
  room: Room;
  anchor: RectCords | undefined;
  onAnchorChange: (anchor: RectCords | undefined) => void;
};

function RoomNavOptions({ room, anchor, onAnchorChange }: RoomNavOptionsProps) {
  const { t } = useTranslation();
  const closeMenu = () => onAnchorChange(undefined);
  const openMenu = (event: React.MouseEvent<HTMLButtonElement>) =>
    onAnchorChange(event.currentTarget.getBoundingClientRect());

  const menu = (
    <FocusTrap
      focusTrapOptions={{
        initialFocus: false,
        clickOutsideDeactivates: true,
        returnFocusOnDeactivate: false,
        onDeactivate: closeMenu,
      }}
    >
      <RoomNavItemMenu room={room} requestClose={closeMenu} />
    </FocusTrap>
  );

  return (
    <NavItemOptions>
      <PopOut anchor={anchor} offset={4} position="Right" align="Start" content={menu}>
        <IconButton
          variant="Background"
          fill="None"
          size="300"
          radii="300"
          aria-label={t('featureUi.roomNav.roomNavItem.moreOptions')}




        </IconButton>
      </PopOut>
    </NavItemOptions>
  );
}

/**
 * One room in the sidebar: avatar or privacy icon, name, unread badge, a mark
 * while agents run background jobs in it, and a menu on hover or focus.
 */
export function RoomNavItem(props: RoomNavItemProps) {
  const { room, selected, linkPath, notificationMode, direct, showAvatar } = props;
  const { t } = useTranslation();
  const [engaged, engagementProps] = useRowEngagement();



  const jobsRunning = useRoomBackgroundJobs(room).length > 0;

  const menuOpen = menuAnchor !== undefined;
  const showOptions = engaged || menuOpen;
  const mutedMark = notificationMode === RoomNotificationMode.Mute && !unread;
  const jobsLabel = t('mindroomUi.backgroundJobs.inRoom');

  let status: React.ReactNode = null;
  if (!showOptions && unread) {
    status = <UnreadBadge highlight={unread.highlight > 0} count={unread.total ?? 0} dm={direct} />;
  } else if (!showOptions && mutedMark) {
    status = (
      <Icon
        size="50"
        src={Icons.Message}
        aria-label={t('sharedUi.powerLevels.muted')}
        style={{ opacity: config.opacity.P300 }}
      />
    );
  }

  return (
    <NavItem
      {...engagementProps}
      variant="Background"
      radii="400"
      aria-selected={selected}
      highlight={unread !== undefined}








              personAvatar={Boolean(direct && showAvatar)}
              selected={selected}
            />
            <Box as="span" grow="Yes">
              <Text as="span" size="Inherit" priority={unread ? '500' : '300'} truncate>
                {name}
              </Text>
            </Box>
            {jobsRunning ? (
              <IconTooltip label={jobsLabel}>
                {(triggerRef) => (
                  <Icon
                    ref={triggerRef}
                    src={Icons.Clock}
                    size="50"
                    aria-label={jobsLabel}
                    style={{ opacity: config.opacity.P500 }}
                  />
                )}
              </IconTooltip>
            ) : null}
            {status}
          </Box>
        </NavItemContent>
      </NavLink>
      {showOptions ? (
        <RoomNavOptions room={room} anchor={menuAnchor} onAnchorChange={setMenuAnchor} />
      ) : null}
    </NavItem>
  );
}
