import React, { useEffect, useRef, useState } from 'react';
import { Avatar, Box, Icon, IconButton, Icons, Text, Tooltip, config, toRem } from 'folds';
import { PopOut, ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { useFocusWithin, useHover } from 'react-aria';
import { useTranslation } from 'react-i18next';
import { RoomType, type Room } from 'matrix-js-sdk';
import { NavItem, NavItemContent, NavItemOptions, NavLink } from '../../ui/nav/NavItem';
import { RoomAvatar, RoomIcon } from '../../avatars/RoomAvatar';
import { UnreadBadge, UnreadBadgeCenter } from '../../ui/UnreadBadge';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useRoomAvatar, useRoomName } from '../../matrix/hooks/useRoomMeta';
import { RoomNotificationMode } from '../../matrix/hooks/useRoomsNotificationPreferences';
import { useRoomUnread } from '../../matrix/state/useUnread';
import { roomToUnreadAtom } from '../../matrix/state/roomToUnread';
import { mxcUrlToHttp } from '../../matrix/matrix';
import { getDirectPartnerId, getRoomAvatarUrl } from '../../matrix/room';
import { nameInitials } from '../../lib/common';
import { useRoomBackgroundJobs } from '../../background-jobs/useRoomBackgroundJobs';
import { useLongPress } from '../../lib/hooks/useLongPress';
import { IconTooltip } from '../../ui/IconTooltip';
import { RoomActionsMenu, useRoomActionDialog } from '../../room/RoomActionsMenu';
import type { RoomActionDialog } from '../../room/roomActions';

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
  /** The space whose list shows the row, which the room's settings and search stay in. */
  spaceId: string;
  /** A finger drags the row: its menu, which the finger's long press opened, closes. */
  dragging: boolean;
  /** The row sits under the room it is a sub-room of: its hash is framed. */
  subRoom: boolean;
}>;

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

/** How long the mouse rests on a row before a cut-off name shows in full, as on the rail. */
const NAME_TOOLTIP_DELAY_MS = 400;

/**
 * The whole name of a row whose name is cut off, in a tooltip beside the row while a mouse rests
 * on its link. Touch and pen leave it closed: a tap opens the room, and a tooltip would only
 * cover the list. Pressing the link closes it.
 */
const useCutOffNameTooltip = (
  rowRef: React.RefObject<HTMLElement>,
  nameRef: React.RefObject<HTMLElement>
) => {
  const [anchor, setAnchor] = useState<RectCords>();
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const close = () => {
    window.clearTimeout(timer.current);
    setAnchor(undefined);
  };
  const onPointerEnter = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    const nameLine = nameRef.current;
    if (!nameLine || nameLine.scrollWidth <= nameLine.clientWidth) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const row = rowRef.current;
      if (row) setAnchor(row.getBoundingClientRect());
    }, NAME_TOOLTIP_DELAY_MS);
  };
  return [anchor, { onPointerEnter, onPointerLeave: close, onPointerDown: close }] as const;
};

type RoomNavItemAvatarProps = {
  room: Room;
  name: string;
  /** Show a person (direct message partner) with initials, instead of the room privacy icon. */
  personAvatar: boolean;
  selected: boolean;
  /** Read rooms show their privacy icon as faint as their name. */
  quiet: boolean;
  /** The row sits under a room: its hash is framed. */
  nested: boolean;
};

function RoomNavItemAvatar(props: RoomNavItemAvatarProps) {
  const { room, name, personAvatar, selected, quiet, nested } = props;
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();
  const avatarMxc = useRoomAvatar(room, personAvatar);
  const isSpace = room.getType() === RoomType.Space;

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
    return (
      <RoomIcon size="100" filled={selected} joinRule={joinRule} space={isSpace} subRoom={nested} />
    );
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
  spaceId?: string;
  /** Shown while the row is hovered, holds focus or has its menu open; hidden, it stays mounted. */
  shown: boolean;
  anchor: RectCords | undefined;
  onAnchorChange: (anchor: RectCords | undefined) => void;
  showDialog: (dialog: RoomActionDialog) => void;
};

function RoomNavOptions({
  room,
  spaceId,
  shown,
  anchor,
  onAnchorChange,
  showDialog,
}: RoomNavOptionsProps) {
  const { t } = useTranslation();
  const menuOpen = anchor !== undefined;
  const closeMenu = () => onAnchorChange(undefined);
  const anchorToButton = (event: React.MouseEvent<HTMLButtonElement>) =>
    onAnchorChange(event.currentTarget.getBoundingClientRect());

  // The button keeps focus while a pointer opened its menu, and a row that can be dragged keeps its
  // buttons' keys from the page, where the menu's focus trap listens for Escape: Escape on the
  // button is heard here first.
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const button = buttonRef.current;
    if (!menuOpen || !button) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event.target === button) onAnchorChange(undefined);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [menuOpen, onAnchorChange]);

  // The focus trap around the menu finds its container through the menu's ref, so Escape and a
  // click outside close the menu. It opens at the row's end, so its own menus open further right.
  const menu = (
    <FocusTrap
      focusTrapOptions={{
        initialFocus: false,
        clickOutsideDeactivates: true,
        returnFocusOnDeactivate: false,
        onDeactivate: closeMenu,
      }}
    >
      <RoomActionsMenu
        room={room}
        spaceId={spaceId}
        submenuSide="Right"
        close={closeMenu}
        showDialog={showDialog}
      />
    </FocusTrap>
  );

  return (
    <NavItemOptions shown={shown}>
      <PopOut anchor={anchor} offset={4} position="Right" align="Start" content={menu}>
        <IconButton
          ref={buttonRef}
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
  const running = useRoomBackgroundJobs(room).total;
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
  /** The line holding the name, to tell whether it is cut off. */
  nameRef: React.Ref<HTMLSpanElement>;
  /** Pointer handlers that show the cut-off name in full. */
  pointerProps: React.HTMLAttributes<HTMLElement>;
  subRoom: boolean;
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
  nameRef,
  pointerProps,
  subRoom,
}: RoomNavLinkProps) {
  return (
    <NavLink to={to} {...pointerProps}>
      <NavItemContent>
        <Box as="span" grow="Yes" alignItems="Center" gap="200">
          <RoomNavItemAvatar
            room={room}
            name={name}
            personAvatar={personAvatar}
            selected={selected}
            quiet={!hasUnread}
            nested={subRoom}
          />
          <Box as="span" grow="Yes">
            <Text
              ref={nameRef}
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

// A finger resting on the row opens its menu, so the browser selects nothing and shows no link
// preview.
const pressableRow: React.CSSProperties = {
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
};

/** The menu opens where the pointer was right-clicked, like a context menu. */
const pointerAnchor = (event: React.MouseEvent): RectCords => ({
  x: event.clientX,
  y: event.clientY,
  width: 0,
  height: 0,
});

/**
 * One room in the sidebar: avatar or privacy icon, name, unread badge, a mark
 * while agents run background jobs in it, and a menu on hover or focus, by right-click or by a
 * long press, which phones need: they show no options button and iOS fires no contextmenu.
 */
export function RoomNavItem(props: RoomNavItemProps) {
  const { room, selected, linkPath, notificationMode, direct, showAvatar, spaceId, dragging } =
    props;
  const subRoom = Boolean(props.subRoom);
  const { t } = useTranslation();
  const [engaged, engagementProps] = useRowEngagement();
  const [optionsAnchor, setOptionsAnchor] = useState<RectCords>();
  const { dialog, showDialog } = useRoomActionDialog();
  // Direction controls in the name show as code points, so they cannot reorder it.
  const name = revealDirectionControls(useRoomName(room));
  const unread = useRoomUnread(room.roomId, roomToUnreadAtom);
  const rowRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const [nameAnchor, namePointerProps] = useCutOffNameTooltip(rowRef, nameRef);

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

  // A long press opens the menu at the row, below or above it; touches inside the menu, which
  // React passes up through its portal, are not the row's.
  const openAtRow = () => {
    const rowElement = rowRef.current;
    if (rowElement) setOptionsAnchor(rowElement.getBoundingClientRect());
  };
  const longPress = useLongPress(openAtRow, (evt) =>
    evt.currentTarget.contains(evt.target as Node)
  );
  useEffect(() => {
    if (dragging) setOptionsAnchor(undefined);
  }, [dragging]);

  const openContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    // Android fires contextmenu for the same long press: the menu stays at the row.
    if ((event.nativeEvent as Partial<PointerEvent>).pointerType === 'touch') openAtRow();
    else setOptionsAnchor(pointerAnchor(event));
  };

  const row = (
    <NavItem
      ref={rowRef}
      {...engagementProps}
      {...longPress}
      style={pressableRow}
      data-menu-open={optionsAnchor ? 'true' : undefined}
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
        nameRef={nameRef}
        pointerProps={namePointerProps}
        subRoom={subRoom}
      />
      {/* Mounted while hidden too, so the button can leave as smoothly as it came. */}
      <RoomNavOptions
        room={room}
        spaceId={spaceId}
        shown={showOptions}
        anchor={optionsAnchor}
        onAnchorChange={setOptionsAnchor}
        showDialog={showDialog}
      />
    </NavItem>
  );

  // The dialogs sit beside the row, so their pointer and focus events do not reach its handlers.
  return (
    <>
      {row}
      {/* folds' PopOut layer covers the screen; as a tooltip it lets the pointer through. */}
      <PopOut
        style={{ pointerEvents: 'none' }}
        anchor={nameAnchor}
        position="Right"
        align="Center"
        offset={8}
        content={
          <Tooltip role="tooltip" style={{ maxWidth: toRem(320) }}>
            <Text size="T300" {...ownDirectionLine}>
              {name}
            </Text>
          </Tooltip>
        }
      />
      {dialog}
    </>
  );
}
