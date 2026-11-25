import React, { useEffect, useId, useRef, useState } from 'react';
import { Box, Icon, Icons, Text, Tooltip, config, toRem } from 'folds';
import type { RectCords } from 'folds';
import { useFocusWithin, useHover } from 'react-aria';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { useInCall } from '../../calls/callStore';
import { useLongPress } from '../../lib/hooks/useLongPress';
import { useRoomBackgroundJobs } from '../../matrix/hooks/useRoomBackgroundJobs';
import { useRoomName } from '../../matrix/hooks/useRoomMeta';
import { RoomNotificationMode } from '../../matrix/hooks/useRoomsNotificationPreferences';
import { roomToUnreadAtom } from '../../matrix/state/roomToUnread';
import { useRoomUnread } from '../../matrix/state/useUnread';
import { useRoomActionDialog } from '../../room/RoomActionsMenu';
import { PopOut, ownDirectionLine, revealDirectionControls } from '../../ui/directional';
import { IconTooltip } from '../../ui/IconTooltip';
import { NavItem, NavItemContent, NavLink } from '../../ui/nav/NavItem';
import { UnreadBadge, UnreadBadgeCenter } from '../../ui/UnreadBadge';
import { RoomDraftMark, SelfDirectTag, useDirectMemberCount } from './DirectRoomRowExtras';
import { RoomActivityTime } from './RoomActivityTime';
import { RoomNavItemAvatar } from './RoomNavItemAvatar';
import { RoomNavOptions } from './RoomNavOptions';
import * as css from './RoomNavItem.css';

type AvatarBadgeProp = React.ReactNode | ((descriptionId: string) => React.ReactNode);

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
  /** Show a subtle pencil icon when this room has an unsent local composer draft. */
  showDraft: boolean;
  /** Display name shown instead of `useRoomName(room)` (e.g. an agent's resolved display name). */
  nameOverride: string;
  /** Fallback MXC avatar URL when a direct partner has no room-level avatar yet. */
  fallbackAvatarMxc: string;
  /** Optional corner badge; a render function receives an `aria-describedby` target ID. */
  avatarBadge: AvatarBadgeProp;
  /** The space whose list shows the row, which the room's settings and search stay in. */
  spaceId: string;
  /** The immediate space section listing this row; offers `Remove from <space>` when permitted. */
  removeFromSpaceId: string;
  /** A finger drags the row: its menu, which the finger's long press opened, closes. */
  dragging: boolean;
  /** The row sits under the room it is a sub-room of: its hash is framed. */
  subRoom: boolean;
  /** Compact relative activity timestamp shown on quiet rows when activity times are enabled. */
  activityTimestamp: number;
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
  rowRef: React.RefObject<HTMLElement | null>,
  nameRef: React.RefObject<HTMLElement | null>
) => {
  const [anchor, setAnchor] = useState<RectCords>();
  const timer = useRef<number>(undefined);
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

/** A phone after the room's name while this device is in a call there. */
function CallMark({ id, label }: { id: string; label: string }) {
  return (
    <>
      <IconTooltip label={label}>
        {(triggerRef) => (
          <Icon
            ref={triggerRef}
            src={Icons.Phone}
            size="50"
            aria-hidden
            style={{ opacity: config.opacity.P500 }}
          />
        )}
      </IconTooltip>
      <span id={id} hidden>
        {label}
      </span>
    </>
  );
}

type RoomNavLinkProps = {
  to: string;
  room: Room;
  name: string;
  personAvatar: boolean;
  groupMemberCount?: number;
  maybeSelfDirect: boolean;
  fallbackAvatarMxc?: string;
  avatarBadge?: AvatarBadgeProp;
  showDraft: boolean;
  showDraftIcon: boolean;
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

/** The link of a room row: avatar, name (stronger with unread messages), job clock, draft mark, and status. */
function RoomNavLink({
  to,
  room,
  name,
  personAvatar,
  groupMemberCount,
  maybeSelfDirect,
  fallbackAvatarMxc,
  avatarBadge,
  showDraft,
  showDraftIcon,
  selected,
  hasUnread,
  status,
  nameRef,
  pointerProps,
  subRoom,
}: RoomNavLinkProps) {
  const { t } = useTranslation();
  const inCall = useInCall(room.roomId);
  const callStatusId = useId();
  const groupCountId = useId();
  const draftStatusId = useId();
  const avatarBadgeDescId = useId();
  const callStatus = inCall ? t('featureUi.calls.transcription.inCall') : undefined;
  const hasGroupCount = Boolean(
    personAvatar && groupMemberCount !== undefined && groupMemberCount > 2
  );
  const hasDynamicBadgeDesc = typeof avatarBadge === 'function';
  const badgeNode = hasDynamicBadgeDesc ? avatarBadge(avatarBadgeDescId) : avatarBadge;
  const describedBy =
    [
      inCall ? callStatusId : undefined,
      hasGroupCount ? groupCountId : undefined,
      showDraft ? draftStatusId : undefined,
      hasDynamicBadgeDesc ? avatarBadgeDescId : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <NavLink to={to} {...pointerProps} aria-describedby={describedBy}>
      <NavItemContent>
        <Box as="span" grow="Yes" alignItems="Center" gap="200">
          <RoomNavItemAvatar
            room={room}
            name={name}
            personAvatar={personAvatar}
            groupMemberCount={groupMemberCount}
            groupCountDescriptionId={groupCountId}
            fallbackAvatarMxc={fallbackAvatarMxc}
            avatarBadge={badgeNode}
            selected={selected}
            quiet={!hasUnread}
            nested={subRoom}
          />
          <span className={css.NameRow}>
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
            {maybeSelfDirect && <SelfDirectTag room={room} />}
          </span>
          <BackgroundJobsMark room={room} />
          {callStatus && <CallMark id={callStatusId} label={callStatus} />}
          {showDraft && (
            <RoomDraftMark room={room} descriptionId={draftStatusId} showIcon={showDraftIcon} />
          )}
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
 * for a call, local draft or agent background jobs, and a menu on hover or focus, by right-click
 * or by a long press, which phones need: they show no options button and iOS fires no contextmenu.
 */
export function RoomNavItem({
  room,
  selected,
  linkPath,
  notificationMode,
  direct,
  showAvatar,
  showDraft,
  nameOverride,
  fallbackAvatarMxc,
  avatarBadge,
  spaceId,
  removeFromSpaceId,
  dragging,
  subRoom = false,
  activityTimestamp,
}: RoomNavItemProps) {
  const { t } = useTranslation();
  const [engaged, engagementProps] = useRowEngagement();
  const [optionsAnchor, setOptionsAnchor] = useState<RectCords>();
  const { dialog, showDialog } = useRoomActionDialog();
  const roomName = useRoomName(room);
  // Direction controls in the name show as code points, so they cannot reorder it.
  const name = revealDirectionControls(nameOverride ?? roomName);
  const unread = useRoomUnread(room.roomId, roomToUnreadAtom);
  const directMemberCount = useDirectMemberCount(room, Boolean(direct));
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
  } else if (!showOptions && activityTimestamp) {
    status = <RoomActivityTime timestamp={activityTimestamp} />;
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
        groupMemberCount={direct ? directMemberCount : undefined}
        maybeSelfDirect={Boolean(direct) && directMemberCount === 1}
        fallbackAvatarMxc={fallbackAvatarMxc}
        avatarBadge={avatarBadge}
        showDraft={Boolean(showDraft)}
        showDraftIcon={!showOptions}
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
        removeFromSpaceId={removeFromSpaceId}
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
