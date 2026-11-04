import React, { useState, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import FocusTrap from 'focus-trap-react';
import classNames from 'classnames';
import type { Room } from 'matrix-js-sdk';
import {
  Avatar,
  Badge,
  Box,
  Icon,
  IconButton,
  Icons,
  PopOut,
  Text,
  Tooltip,
  TooltipProvider,
  type IconSrc,
  type RectCords,
} from 'folds';
import { PageHeader } from '../../components/page';
import { RoomTopicViewer } from '../../components/room-topic-viewer';
import { RoomAvatar, RoomIcon } from '../../components/room-avatar';
import { InviteUserPrompt } from '../../components/invite-user-prompt';
import { LeaveRoomPrompt } from '../../components/leave-room-prompt';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useIsDirectRoom, useRoom } from '../../hooks/useRoom';
import { useSpaceOptionally } from '../../hooks/useSpace';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRoomAvatar, useRoomName, useRoomTopic } from '../../hooks/useRoomMeta';
import { useStateEvent } from '../../hooks/useStateEvent';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { usePowerLevelsContext } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { useRoomPinnedEvents } from '../../hooks/useRoomPinnedEvents';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useOpenRoomSettings } from '../../state/hooks/roomSettings';
import { getCanonicalAliasOrRoomId, isRoomAlias, mxcUrlToHttp } from '../../utils/matrix';
import { copyToClipboard } from '../../utils/dom';
import { nameInitials } from '../../utils/common';
import { getDirectPartnerId } from '../../utils/room';
import { getMatrixToRoom } from '../../plugins/matrix-to';
import { getViaServers } from '../../plugins/via-servers';
import {
  getDirectPath,
  getHomePath,
  getHomeSearchPath,
  getSpacePath,
  getSpaceSearchPath,
  withSearchParam,
} from '../../pages/pathUtils';
import { StateEvent } from '../../../types/matrix/room';
import { RoomPinMenu } from '../messages/MindroomRoomPinMenu';
import { RoomSchedulesButton } from '../schedules/RoomSchedulesButton';
import { CanvasHeaderButton } from '../canvas/CanvasHeaderButton';
import { useCallPanel } from '../../features/calls/callStore';
import type { CanvasListEntry } from '../canvas/canvasIndexStore';
import { useMembersDrawer } from '../sidebar/useMembersDrawer';
import { useRoomViewMode } from './useRoomViewMode';
import type { RoomViewMode } from './roomViewMode';
import { RoomHeaderMenu } from './RoomHeaderMenu';
import { CompactViewIcon } from './roomViewSwitchIcon';
import { HeaderTopic } from '../../features/room/RoomViewHeader.css';
import * as css from './MindroomRoomViewHeader.css';

export type RoomViewHeaderProps = {
  hasMindroomAgents?: boolean;
  joinRequestCount?: number;
  /** The open thread, if any: the room's view switch does not apply inside a thread. */
  threadId?: string;
  computerAvailable?: boolean;
  computerOpen?: boolean;
  /** Whether an agent or the user showed the computer in this conversation before. */
  computerShown?: boolean;
  onComputerToggle?: () => void;
  canvasOpen?: boolean;
  canvases?: CanvasListEntry[];
  openCanvasId?: string;
  onCanvasOpen?: (canvasId: string) => void;
  onCanvasClose?: () => void;
  /** The call controls, which the room provides (`HeaderCallButtons`) for where they go. */
  calls?: (placement: HeaderCallPlacement) => ReactNode;
};

/**
 * Where the header puts the call controls: its row of buttons, or on phones also the room menu,
 * since a phone's header has no room for them beside the name.
 */
export type HeaderCallPlacement =
  | { at: 'header'; phone: boolean }
  | { at: 'menu'; requestClose: () => void };

type HeaderActionProps = {
  label: string;
  icon: IconSrc;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  /** For a toggle whose name stays the same in both states. */
  pressed?: boolean;
  /** Tints the button, for a mode that is on. */
  active?: boolean;
  /** Drawn over the button's corner, such as a count. */
  badge?: ReactNode;
  /** The icon points along the reading direction, so right-to-left languages mirror it. */
  directional?: boolean;
  buttonProps?: Record<`data-${string}` | `aria-${string}`, string | boolean | undefined>;
};

/** An icon-only header button that names itself in a tooltip, as screen readers hear it. */
function HeaderAction({
  label,
  icon,
  onClick,
  pressed,
  active,
  badge,
  directional,
  buttonProps,
}: HeaderActionProps) {
  return (
    <TooltipProvider
      position="Bottom"
      offset={4}
      tooltip={
        <Tooltip>
          <Text size="T200">{label}</Text>
        </Tooltip>
      }
    >
      {(anchorRef) => (
        <IconButton
          ref={anchorRef}
          size="400"
          radii="300"
          variant={active ? 'Primary' : 'Surface'}
          fill={active ? 'Soft' : 'None'}
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          style={badge ? { position: 'relative' } : undefined}
          {...buttonProps}
        >
          <Icon size="400" src={icon} data-directional={directional || undefined} />
          {badge}
        </IconButton>
      )}
    </TooltipProvider>
  );
}

// On the Members button's top end corner, out of the pointer's way.
const joinRequestBadgeStyle = {
  position: 'absolute',
  top: 0,
  insetInlineEnd: 0,
  pointerEvents: 'none',
} as const;

const rectOf = (event: MouseEvent<HTMLElement>): RectCords => {
  const { x, y, width, height } = event.currentTarget.getBoundingClientRect();
  return { x, y, width, height };
};

/** Where a phone's back button leads: the list the room was opened from. */
const sectionPathOf = (spacePathId: string | undefined, isDirect: boolean): string => {
  if (spacePathId) return getSpacePath(spacePathId);
  return isDirect ? getDirectPath() : getHomePath();
};

/** The Compact and Full switch: Compact shows threads as bars, Full the classic timeline. */
const useViewSwitch = (room: Room) => {
  const { viewMode, setViewMode, availableViewModes } = useRoomViewMode(room.roomId);
  const fullMode: RoomViewMode | undefined = availableViewModes.includes('classic')
    ? 'classic'
    : availableViewModes.find((mode) => mode !== 'compact');
  if (!availableViewModes.includes('compact') || fullMode === undefined) return undefined;
  const compact = viewMode === 'compact';
  return { compact, toggle: () => setViewMode(compact ? fullMode : 'compact') };
};

/**
 * The room header: avatar (a back button on phones), name and topic, then the Compact and Full
 * switch, scheduled tasks, canvases, the computer, calls, pinned messages, members and the room
 * menu. Phones show a call button only while a call is on and offer the rest in the room menu.
 */
export function RoomViewHeader({
  hasMindroomAgents,
  joinRequestCount = 0,
  threadId,
  computerAvailable,
  computerOpen,
  computerShown,
  onComputerToggle,
  canvasOpen,
  canvases,
  openCanvasId,
  onCanvasOpen,
  onCanvasClose,
  calls,
}: RoomViewHeaderProps) {
  const room = useRoom();
  const { t } = useTranslation();
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const mx = useMatrixClient();
  const viewSwitch = useViewSwitch(room);
  const navigate = useNavigate();
  const [membersOpen, setMembersOpen] = useMembersDrawer();
  const openRoomSettings = useOpenRoomSettings();
  const { navigateRoomThread } = useRoomNavigate();
  const encrypted = useStateEvent(room, StateEvent.RoomEncryption) !== undefined;
  const pinnedCount = useRoomPinnedEvents(room).length;
  const authenticatedMedia = useMediaAuthentication();
  const permissions = useRoomPermissions(useRoomCreators(room), usePowerLevelsContext());
  const myUserId = mx.getSafeUserId();

  // Spaces and direct chats are addressed like their links: by canonical alias when there is one.
  const space = useSpaceOptionally();
  const spacePathId = space ? getCanonicalAliasOrRoomId(mx, space.roomId) : undefined;
  const direct = useIsDirectRoom();
  const sectionPath = sectionPathOf(spacePathId, direct);

  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const [pinAnchor, setPinAnchor] = useState<RectCords>();
  const [prompt, setPrompt] = useState<'invite' | 'leave'>();

  // A direct chat shows the other person, by picture or initial.
  const pictureMxc = useRoomAvatar(room, direct);
  // Twice the 36 px avatar, so it stays sharp on high-density screens.
  const avatarSrc = pictureMxc
    ? mxcUrlToHttp(mx, pictureMxc, authenticatedMedia, 72, 72, 'crop') ?? undefined
    : undefined;
  const roomName = useRoomName(room);
  const topic = useRoomTopic(room);
  const [topicOpen, setTopicOpen] = useState(false);

  // Canvas, computer and call take the side panel's place, so the members panel is hidden
  // behind them.
  const [callOpen, setCallOpen] = useCallPanel(room.roomId);
  const sidePanelTaken = !!computerOpen || !!canvasOpen || callOpen;
  const membersVisible = membersOpen && !sidePanelTaken;
  const toggleMembers = () => {
    if (membersVisible) {
      setMembersOpen(false);
      return;
    }
    if (computerOpen) onComputerToggle?.();
    if (canvasOpen) onCanvasClose?.();
    if (callOpen) setCallOpen(false);
    setMembersOpen(true);
  };
  const membersLabel = membersVisible
    ? t('mindroomUi.threads.mindroomRoomViewHeader.hideMembers')
    : t('mindroomUi.threads.mindroomRoomViewHeader.showMembers');
  // Only someone who can let people in (invite) or turn them away (kick) acts on join requests.
  const canAnswerJoinRequests =
    permissions.action('invite', myUserId) || permissions.action('kick', myUserId);
  const pendingRequests = canAnswerJoinRequests ? joinRequestCount : 0;

  // The header keeps a Computer button once the computer was shown; phones have no room for it.
  const canToggleComputer = !!computerAvailable && !!onComputerToggle;
  const computerButton = canToggleComputer && !mobile && (!!computerShown || !!computerOpen);
  const computerInMenu = canToggleComputer && !computerButton;

  const showCanvases = !!canvases && !!onCanvasOpen && !!onCanvasClose;

  const copyRoomLink = () => {
    const target = getCanonicalAliasOrRoomId(mx, room.roomId);
    const via = isRoomAlias(target) ? undefined : getViaServers(room);
    void copyToClipboard(getMatrixToRoom(target, via));
  };
  const searchMessages = () => {
    const searchPath = spacePathId ? getSpaceSearchPath(spacePathId) : getHomeSearchPath();
    navigate(withSearchParam(searchPath, { rooms: room.roomId }));
  };

  return (
    // Inside the main landmark a header is no banner by itself; the room's title bar stays one,
    // the landmark that names the open room.
    <PageHeader role="banner" className={css.Header} balance={mobile}>
      <Box grow="Yes" alignItems="Center" gap="300" style={{ minWidth: 0 }}>
        {mobile ? (
          <HeaderAction
            label={t('mindroomUi.threads.mindroomRoomViewHeader.back')}
            icon={Icons.ArrowLeft}
            directional
            onClick={() => navigate(sectionPath)}
          />
        ) : (
          <Avatar size="300" radii="400" style={{ flexShrink: 0 }}>
            <RoomAvatar
              alt={roomName}
              src={avatarSrc}
              roomId={room.roomId}
              fallbackId={direct ? getDirectPartnerId(room) : undefined}
              renderFallback={() =>
                direct ? (
                  <Text as="span" size="H5">
                    {nameInitials(roomName)}
                  </Text>
                ) : (
                  <RoomIcon size="200" joinRule={room.getJoinRule()} filled />
                )
              }
            />
          </Avatar>
        )}
        <Box direction="Column" style={{ minWidth: 0 }}>
          <Text as="h1" size="H5" truncate>
            {roomName}
          </Text>
          {topic && (
            <button
              type="button"
              className={classNames(HeaderTopic, css.Topic)}
              onClick={() => setTopicOpen(true)}
            >
              <Text as="span" size="T200" priority="300" truncate>
                {topic}
              </Text>
            </button>
          )}
          {topic && topicOpen && (
            <RoomTopicViewer
              name={roomName}
              topic={topic}
              requestClose={() => setTopicOpen(false)}
            />
          )}
        </Box>
      </Box>
      <Box shrink="No" alignItems="Center">
        {viewSwitch && !threadId && (
          <HeaderAction
            label={t('mindroomUi.threads.mindroomRoomViewHeader.compactView')}
            icon={CompactViewIcon}
            pressed={viewSwitch.compact}
            active={viewSwitch.compact}
            onClick={viewSwitch.toggle}
            buttonProps={{ 'data-room-view-switch': '' }}
          />
        )}
        {hasMindroomAgents && (
          <RoomSchedulesButton
            room={room}
            onOpenThread={(scheduledThreadId) => navigateRoomThread(room.roomId, scheduledThreadId)}
          />
        )}
        {showCanvases && (
          <CanvasHeaderButton
            canvases={canvases}
            openCanvasId={openCanvasId}
            onOpen={onCanvasOpen}
            onClose={onCanvasClose}
          />
        )}
        {computerButton && (
          <HeaderAction
            label={
              computerOpen
                ? t('mindroomUi.threads.mindroomRoomViewHeader.hideComputer')
                : t('mindroomUi.threads.mindroomRoomViewHeader.showComputer')
            }
            icon={Icons.Monitor}
            active={!!computerOpen}
            onClick={() => onComputerToggle?.()}
          />
        )}
        {calls?.({ at: 'header', phone: mobile })}
        {pinnedCount > 0 && (
          <HeaderAction
            label={t('mindroomUi.threads.mindroomRoomViewHeader.pinnedMessages')}
            icon={Icons.Pin}
            onClick={(event) => setPinAnchor(rectOf(event))}
            buttonProps={{ 'aria-haspopup': 'dialog', 'aria-expanded': !!pinAnchor }}
          />
        )}
        <HeaderAction
          label={
            pendingRequests > 0
              ? t('featureUi.room.pendingJoinRequests.accessibleLabel', {
                  baseLabel: membersLabel,
                  count: pendingRequests,
                })
              : membersLabel
          }
          icon={Icons.User}
          onClick={() => toggleMembers()}
          badge={
            pendingRequests > 0 && (
              <Badge
                style={joinRequestBadgeStyle}
                size="200"
                variant="Primary"
                fill="Solid"
                radii="Pill"
                aria-hidden="true"
              >
                <Text size="L400">{pendingRequests}</Text>
              </Badge>
            )
          }
        />
        <HeaderAction
          label={t('mindroomUi.threads.mindroomRoomViewHeader.moreOptions')}
          icon={Icons.VerticalDots}
          onClick={(event) => setMenuAnchor(rectOf(event))}
          buttonProps={{ 'aria-haspopup': 'menu', 'aria-expanded': !!menuAnchor }}
        />
      </Box>
      <PopOut
        anchor={pinAnchor}
        position="Bottom"
        align="End"
        offset={4}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              clickOutsideDeactivates: () => {
                setPinAnchor(undefined);
                return true;
              },
              escapeDeactivates: () => {
                setPinAnchor(undefined);
                return true;
              },
            }}
          >
            <RoomPinMenu room={room} requestClose={() => setPinAnchor(undefined)} />
          </FocusTrap>
        }
      />
      <PopOut
        anchor={menuAnchor}
        position="Bottom"
        align="End"
        offset={4}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              clickOutsideDeactivates: () => {
                setMenuAnchor(undefined);
                return true;
              },
              escapeDeactivates: () => {
                setMenuAnchor(undefined);
                return true;
              },
            }}
          >
            <RoomHeaderMenu
              room={room}
              requestClose={() => setMenuAnchor(undefined)}
              onInvite={
                permissions.action('invite', myUserId) ? () => setPrompt('invite') : undefined
              }
              onCopyLink={copyRoomLink}
              onOpenSettings={() => openRoomSettings(room.roomId, space?.roomId)}
              onSearchMessages={encrypted ? undefined : searchMessages}
              onShowComputer={
                computerInMenu
                  ? () => {
                      if (!computerOpen) onComputerToggle?.();
                    }
                  : undefined
              }
              calls={
                mobile
                  ? calls?.({ at: 'menu', requestClose: () => setMenuAnchor(undefined) })
                  : undefined
              }
              onLeave={() => setPrompt('leave')}
            />
          </FocusTrap>
        }
      />
      {prompt === 'invite' && (
        <InviteUserPrompt room={room} requestClose={() => setPrompt(undefined)} />
      )}
      {prompt === 'leave' && (
        <LeaveRoomPrompt
          roomId={room.roomId}
          requestClose={() => setPrompt(undefined)}
          onLeft={() => {
            setPrompt(undefined);
            navigate(sectionPath);
          }}
        />
      )}
    </PageHeader>
  );
}
