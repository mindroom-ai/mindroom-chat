import React, { forwardRef, useState } from 'react';
import { Avatar, Box, Icon, IconButton, Icons, Line, Spinner, Text, config, toRem } from 'folds';
import { PopOut, ownDirectionLine } from '../../components/directional';
import { Menu } from '../../components/glass/GlassPrimitives';
import { MenuEntry } from '../../components/MenuEntry';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { useFocusWithin, useHover } from 'react-aria';
import { useTranslation } from 'react-i18next';
import { RoomType, type Room } from 'matrix-js-sdk';
import { NavItem, NavItemContent, NavItemOptions, NavLink } from '../../components/nav';
import { RoomAvatar, RoomIcon } from '../../components/room-avatar';
import { UnreadBadge, UnreadBadgeCenter } from '../../components/unread-badge';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRoomAvatar, useRoomName } from '../../hooks/useRoomMeta';
import {
  RoomNotificationMode,
  getRoomNotificationModeIcon,
} from '../../hooks/useRoomsNotificationPreferences';
import { RoomNotificationModeSwitcher } from '../../components/RoomNotificationSwitcher';
import { useRoomUnread } from '../../state/hooks/unread';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { useOpenRoomSettings } from '../../state/hooks/roomSettings';
import { getCanonicalAliasOrRoomId, mxcUrlToHttp } from '../../utils/matrix';
import { getDirectPartnerId, getRoomAvatarUrl } from '../../utils/room';
import { copyToClipboard } from '../../utils/dom';
import { nameInitials } from '../../utils/common';
import { getMatrixToRoom } from '../../plugins/matrix-to';
import { useRoomBackgroundJobs } from '../../mindroom/background-jobs/useRoomBackgroundJobs';
import { IconTooltip } from '../../mindroom/tooltip/IconTooltip';
import { MindroomMarkRoomReadMenuItem } from '../../mindroom/notifications/MindroomMarkRoomReadMenuItem';
import { ArchiveRoomMenuItem } from '../../mindroom/rooms/ArchiveRoomMenuItem';
import { InviteUserPrompt } from '../../components/invite-user-prompt';
import { LeaveRoomPrompt } from '../../components/leave-room-prompt';
import { usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';

const AVATAR_SIZE = 96;

type RoomNavItemProps = {
  room: Room;
  selected: boolean;
  /** Where the row links to. */
  linkPath: string;
} & Partial<{
  /** Muted rooms without unread messages show a muted mark; rows without a mode show none. */
  notificationMode: RoomNotificationMode;
  /** A direct message: shows the other person's avatar with initials as fallback. */
  direct: boolean;
  showAvatar: boolean;
}>;

/** A dialog the row's menu opened; it outlives the menu, which closes first. */
type RoomNavPrompt = 'invite' | 'leave';

type RoomNavItemMenuProps = {
  room: Room;
  requestClose: () => void;
  onPrompt: (prompt: RoomNavPrompt) => void;
  /** The room's notification mode; rows without one offer no mode switch. */
  notificationMode?: RoomNotificationMode;
};

const menuGroupStyle = { padding: config.space.S100 } as const;
const roomMenuStyle = { minWidth: toRem(200) } as const;

// The focus trap around the menu finds its container through this ref, so Escape and a click
// outside close the menu.
const RoomNavItemMenu = forwardRef<HTMLDivElement, RoomNavItemMenuProps>(function RoomNavItemMenu(
  { room, requestClose, onPrompt, notificationMode },
  ref
) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const openRoomSettings = useOpenRoomSettings();
  const permissions = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const canInvite = permissions.action('invite', client.getUserId() ?? '');

  const closeThen = (action: () => void) => () => {
    requestClose();
    action();
  };

  // A matrix.to link, which opens the room in any Matrix client.
  const shareableLink = getMatrixToRoom(getCanonicalAliasOrRoomId(client, room.roomId));

  return (
    <Menu style={roomMenuStyle} ref={ref}>
      <Box direction="Column" gap="100" style={menuGroupStyle}>
        <MindroomMarkRoomReadMenuItem room={room} onClose={requestClose} />
        {notificationMode && (
          <RoomNotificationModeSwitcher
            roomId={room.roomId}
            value={notificationMode}
            onChange={requestClose}
            side="Right"
          >
            {(handleOpen, opened, changing) => (
              <MenuEntry
                icon={getRoomNotificationModeIcon(notificationMode)}
                label={t('featureUi.roomNav.roomNavItem.notifications')}
                onSelect={handleOpen}
                after={changing ? <Spinner size="100" variant="Secondary" /> : undefined}
                fill={opened ? 'Soft' : 'None'}
                aria-haspopup="menu"
                aria-expanded={opened}
              />
            )}
          </RoomNotificationModeSwitcher>
        )}
        {canInvite && (
          <MenuEntry
            icon={Icons.UserPlus}
            label={t('featureUi.roomNav.roomNavItem.invite')}
            onSelect={closeThen(() => onPrompt('invite'))}
          />
        )}
        <MenuEntry
          icon={Icons.Link}
          label={t('featureUi.roomNav.roomNavItem.copyLink')}
          onSelect={closeThen(() => void copyToClipboard(shareableLink))}
        />
        <MenuEntry
          icon={Icons.Setting}
          label={t('featureUi.roomNav.roomNavItem.roomSettings')}
          onSelect={closeThen(() => openRoomSettings(room.roomId))}
        />
      </Box>
      <Line variant="Surface" size="300" />
      <Box direction="Column" gap="100" style={menuGroupStyle}>
        <ArchiveRoomMenuItem room={room} onClose={requestClose} />
        <MenuEntry
          critical
          directional
          icon={Icons.ArrowGoLeft}
          label={t('featureUi.roomNav.roomNavItem.leaveRoom')}
          onSelect={closeThen(() => onPrompt('leave'))}
        />
      </Box>
    </Menu>
  );
});

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
  /** Read rooms show their privacy icon as faint as their name. */
  quiet: boolean;
};

function RoomNavItemAvatar({ room, name, personAvatar, selected, quiet }: RoomNavItemAvatarProps) {
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

  // A room without a picture shows the bare privacy icon, with no tinted tile behind it.
  if (!src && !personAvatar) {
    return (
      <Avatar size="200" radii="400" style={quiet ? { opacity: config.opacity.P300 } : undefined}>
        {renderFallback()}
      </Avatar>
    );
  }

  // A room picture that fails falls back to the same bare icon as a room without one.
  const failedTone = personAvatar ? undefined : 'plain';
  return (
    <Avatar size="200" radii="400">
      <RoomAvatar
        fallbackTone={failedTone}
        fallbackId={personAvatar ? getDirectPartnerId(room) : undefined}
        renderFallback={renderFallback}
        alt={name}
        src={src}
        roomId={room.roomId}
      />
    </Avatar>
  );
}

type RoomNavOptionsProps = {
  room: Room;
  /** Shown while the row is hovered, holds focus or has its menu open; hidden, it stays mounted. */
  shown: boolean;
  anchor: RectCords | undefined;
  onAnchorChange: (anchor: RectCords | undefined) => void;
  onPrompt: (prompt: RoomNavPrompt) => void;
  notificationMode?: RoomNotificationMode;
};

function RoomNavOptions({
  room,
  shown,
  anchor,
  onAnchorChange,
  onPrompt,
  notificationMode,
}: RoomNavOptionsProps) {
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
      <RoomNavItemMenu
        room={room}
        requestClose={closeMenu}
        onPrompt={onPrompt}
        notificationMode={notificationMode}
      />
    </FocusTrap>
  );

  return (
    <NavItemOptions shown={shown}>
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

/** A clock after the room's name while an agent runs a background job in the room. */
function BackgroundJobsMark({ room }: { room: Room }) {
  const { t } = useTranslation();
  const running = useRoomBackgroundJobs(room).length;
  if (running === 0) return null;
  const label = t('mindroomUi.backgroundJobs.inRoom');
  return (
    <IconTooltip label={label}>
      {(triggerRef) => (
        <Icon
          ref={triggerRef}
          src={Icons.Clock}
          size="50"
          aria-label={label}
          style={{ opacity: config.opacity.P500 }}
        />
      )}
    </IconTooltip>
  );
}

type RoomNavLinkProps = {
  to: string;
  room: Room;
  name: string;
  personAvatar: boolean;
  selected: boolean;
  hasUnread: boolean;
  /** Unread badge or muted mark at the end of the row. */
  status: React.ReactNode;
};

/** The link of a room row: avatar, name (stronger with unread messages), job clock and status. */
function RoomNavLink({
  to,
  room,
  name,
  personAvatar,
  selected,
  hasUnread,
  status,
}: RoomNavLinkProps) {
  return (
    <NavLink to={to}>
      <NavItemContent>
        <Box as="span" grow="Yes" alignItems="Center" gap="200">
          <RoomNavItemAvatar
            room={room}
            name={name}
            personAvatar={personAvatar}
            selected={selected}
            quiet={!hasUnread}
          />
          <Box as="span" grow="Yes">
            <Text
              as="span"
              size="Inherit"
              priority={hasUnread ? '500' : '300'}
              truncate
              {...ownDirectionLine}
            >
              {name}
            </Text>
          </Box>
          <BackgroundJobsMark room={room} />
          {status && <UnreadBadgeCenter>{status}</UnreadBadgeCenter>}
        </Box>
      </NavItemContent>
    </NavLink>
  );
}

/** The menu opens where the pointer was right-clicked, like a context menu. */
const pointerAnchor = (event: React.MouseEvent): RectCords => ({
  x: event.clientX,
  y: event.clientY,
  width: 0,
  height: 0,
});

/**
 * One room in the sidebar: avatar or privacy icon, name, unread badge, a mark
 * while agents run background jobs in it, and a menu on hover or focus or by right-click.
 */
export function RoomNavItem(props: RoomNavItemProps) {
  const { room, selected, linkPath, notificationMode, direct, showAvatar } = props;
  const { t } = useTranslation();
  const [engaged, engagementProps] = useRowEngagement();
  const [optionsAnchor, setOptionsAnchor] = useState<RectCords>();
  const [prompt, setPrompt] = useState<RoomNavPrompt>();
  const name = useRoomName(room);
  const unread = useRoomUnread(room.roomId, roomToUnreadAtom);

  const showOptions = engaged || optionsAnchor !== undefined;
  const mutedMark = notificationMode === RoomNotificationMode.Mute && !unread;

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

  const openContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    setOptionsAnchor(pointerAnchor(event));
  };
  const closePrompt = () => setPrompt(undefined);

  const row = (
    <NavItem
      {...engagementProps}
      onContextMenu={openContextMenu}
      highlight={Boolean(unread)}
      aria-selected={selected}
      variant="Background"
      radii="400"
    >
      <RoomNavLink
        to={linkPath}
        room={room}
        name={name}
        personAvatar={Boolean(direct && showAvatar)}
        selected={selected}
        hasUnread={Boolean(unread)}
        status={status}
      />
      {/* Mounted while hidden too, so the button can leave as smoothly as it came. */}
      <RoomNavOptions
        room={room}
        shown={showOptions}
        anchor={optionsAnchor}
        onAnchorChange={setOptionsAnchor}
        onPrompt={setPrompt}
        notificationMode={notificationMode}
      />
    </NavItem>
  );

  // The dialogs sit beside the row, so their pointer and focus events do not reach its handlers.
  return (
    <>
      {row}
      {prompt === 'invite' && <InviteUserPrompt room={room} requestClose={closePrompt} />}
      {prompt === 'leave' && (
        <LeaveRoomPrompt roomId={room.roomId} requestClose={closePrompt} onLeft={closePrompt} />
      )}
    </>
  );
}
