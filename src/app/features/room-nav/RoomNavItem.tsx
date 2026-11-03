import React, { useState } from 'react';
import {
  Avatar,
  Box,
  Icon,
  IconButton,
  type IconSrc,
  Icons,
  PopOut,
  Text,
  config,
  toRem,
} from 'folds';
import { Menu, MenuItem } from '../../components/glass/GlassPrimitives';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { useFocusWithin, useHover } from 'react-aria';
import { useTranslation } from 'react-i18next';
import { RoomType, type Room } from 'matrix-js-sdk';
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
import { nameInitials } from '../../utils/common';
import { getMatrixToRoom } from '../../plugins/matrix-to';
import { useRoomBackgroundJobs } from '../../mindroom/background-jobs/useRoomBackgroundJobs';
import { IconTooltip } from '../../mindroom/tooltip/IconTooltip';
import { MindroomMarkRoomReadMenuItem } from '../../mindroom/notifications/MindroomMarkRoomReadMenuItem';

const AVATAR_SIZE = 96;

type RoomNavItemProps = {
  room: Room;
  selected: boolean;
  /** Where the row links to. */
  linkPath: string;
  /** Muted rooms without unread messages show a muted mark. */
  notificationMode: RoomNotificationMode;
  /** A direct message: shows the other person's avatar with initials as fallback. */
  direct?: boolean;
  showAvatar?: boolean;
};

function RoomNavItemMenu({ room, requestClose }: { room: Room; requestClose: () => void }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const openRoomSettings = useOpenRoomSettings();

  const handleCopyLink = () => {
    void copyToClipboard(getMatrixToRoom(getCanonicalAliasOrRoomId(client, room.roomId)));
    requestClose();
  };

  const handleLeave = () => {
    void client.leave(room.roomId);
    requestClose();
  };

  return (
    <Menu style={{ minWidth: toRem(176) }}>
      <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
        <MindroomMarkRoomReadMenuItem room={room} onClose={requestClose} />
        <RoomMenuEntry
          icon={Icons.Link}
          label={t('featureUi.roomNav.roomNavItem.copyLink')}
          onClick={handleCopyLink}
        />
        <RoomMenuEntry
          icon={Icons.Setting}
          label={t('featureUi.roomNav.roomNavItem.roomSettings')}
          onClick={() => {
            openRoomSettings(room.roomId);
            requestClose();
          }}
        />
        <RoomMenuEntry
          critical
          icon={Icons.ArrowGoLeft}
          label={t('featureUi.roomNav.roomNavItem.leaveRoom')}
          onClick={handleLeave}
        />
      </Box>
    </Menu>
  );
}

type RoomMenuEntryProps = {
  icon: IconSrc;
  label: string;
  onClick: () => void;
  /** Leaving is styled as a destructive action. */
  critical?: boolean;
};

function RoomMenuEntry({ icon, label, onClick, critical }: RoomMenuEntryProps) {
  return (
    <MenuItem
      size="300"
      radii="300"
      variant={critical ? 'Critical' : 'Surface'}
      after={<Icon size="100" src={icon} />}
      onClick={onClick}
    >
      <Text as="span" size="T300" truncate style={{ flexGrow: 1 }}>
        {label}
      </Text>
    </MenuItem>
  );
}

/**
 * Whether the pointer is over the row or focus is inside it; the row swaps its badge for the
 * options button while either holds. The props go on the row element.
 */
const useRowEngagement = () => {
  const [hovering, setHovering] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const { hoverProps } = useHover({ onHoverChange: setHovering });
  const { focusWithinProps } = useFocusWithin({ onFocusWithinChange: setFocusInside });
  const engaged = hovering || focusInside;
  return [engaged, { ...hoverProps, ...focusWithinProps }] as const;
};

type RoomNavItemAvatarProps = {
  room: Room;
  name: string;
  /** Show a person (direct message partner) with initials, instead of the room privacy icon. */
  personAvatar: boolean;
  selected: boolean;
};

function RoomNavItemAvatar({ room, name, personAvatar, selected }: RoomNavItemAvatarProps) {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const avatarMxc = useRoomAvatar(room, personAvatar);

  let src = avatarMxc
    ? mxcUrlToHttp(mx, avatarMxc, useAuthentication, AVATAR_SIZE, AVATAR_SIZE, 'crop') ?? undefined
    : undefined;
  // A partner without an avatar shows the room's own, which is only looked up then.
  if (!src && personAvatar) src = getRoomAvatarUrl(mx, room, AVATAR_SIZE, useAuthentication);

  const renderFallback = () => {
    if (personAvatar) {
      return (
        <Text as="span" size="H6">
          {nameInitials(name)}
        </Text>
      );
    }
    const joinRule = room.getJoinRule();
    const isSpace = room.getType() === RoomType.Space;
    return <RoomIcon size="100" filled={selected} joinRule={joinRule} space={isSpace} />;
  };

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
  const menuOpen = anchor !== undefined;
  const closeMenu = () => onAnchorChange(undefined);
  const anchorToButton = (event: React.MouseEvent<HTMLButtonElement>) =>
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
          aria-pressed={menuOpen}
          onClick={anchorToButton}
        >
          <Icon size="50" src={Icons.VerticalDots} />
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
  const [optionsAnchor, setOptionsAnchor] = useState<RectCords>();
  const name = useRoomName(room);
  const unread = useRoomUnread(room.roomId, roomToUnreadAtom);
  const jobsRunning = useRoomBackgroundJobs(room).length > 0;

  const showOptions = engaged || optionsAnchor !== undefined;
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
      highlight={Boolean(unread)}
    >
      <NavLink to={linkPath}>
        <NavItemContent>
          <Box as="span" grow="Yes" alignItems="Center" gap="200">
            <RoomNavItemAvatar
              room={room}
              name={name}
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
        <RoomNavOptions room={room} anchor={optionsAnchor} onAnchorChange={setOptionsAnchor} />
      ) : null}
    </NavItem>
  );
}
