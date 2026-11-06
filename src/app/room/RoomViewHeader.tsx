import { useState, type MouseEvent, type ReactNode } from 'react';
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
  Text,
  Tooltip,
  toRem,
  type IconSrc,
  type RectCords,
} from 'folds';
import { PopOut, TooltipProvider, ownDirectionLine } from '../ui/directional';
import { PageHeader } from '../ui/page/Page';
import { PhoneBackButton } from '../ui/page/PhoneBackButton';
import { RoomTopicViewer } from './RoomTopicViewer';
import { RoomAvatar, RoomIcon } from '../avatars/RoomAvatar';
import { InviteUserPrompt } from '../members/invite/InviteUserPrompt';
import { LeaveRoomPrompt } from '../rooms/LeaveRoomPrompt';
import { JumpToTime } from '../timeline/jump-to-time/JumpToTime';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useIsDirectRoom, useRoom } from '../matrix/hooks/useRoom';
import { useSpaceOptionally } from '../matrix/hooks/useSpace';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { useRoomAvatar, useRoomName, useRoomTopic } from '../matrix/hooks/useRoomMeta';
import { useStateEvent } from '../matrix/hooks/useStateEvent';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { usePowerLevelsContext } from '../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../matrix/hooks/useRoomPermissions';
import { usePinnedEventIds as useRoomPinnedEvents } from '../event-store/threads/useThreadPinning';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { useOpenRoomSettings } from '../navigation/useRoomSettingsState';
import { useSetting } from '../preferences/useSetting';
import { settingsAtom } from '../preferences/settings';
import { getCanonicalAliasOrRoomId, isRoomAlias, mxcUrlToHttp } from '../matrix/matrix';
import { copyToClipboard } from '../lib/dom';
import { nameInitials } from '../lib/common';
import { getDirectPartnerId } from '../matrix/room';
import { getMatrixToRoom } from '../matrix/matrix-to';
import { getViaServers } from '../matrix/via-servers';
import {
  getDirectPath,
  getHomePath,
  getHomeSearchPath,
  getSpacePath,
  getSpaceSearchPath,
  withSearchParam,
} from '../routes/pathUtils';
import { previousHistoryOrigin, showsRoom } from '../routes/historyStack';
import { StateEvent } from '../matrix/types/room';
import { RoomPinMenu } from '../messages/pins/RoomPinMenu';
import {
  RoomSchedulesButton,
  RoomSchedulesMenuEntry,
  RoomSchedulesOverlay,
} from '../schedules/RoomSchedulesButton';
import { CanvasHeaderButton, CanvasMenu } from '../canvas/CanvasHeaderButton';
import { MenuEntry } from '../ui/MenuEntry';
import { useCallPanel } from '../calls/callStore';
import type { CanvasListEntry } from '../canvas/canvasIndexStore';
import { useMembersDrawer } from '../members/useMembersDrawer';
import { ShortcutLabel, shortcutAttributes } from '../shortcuts/ShortcutKeys';
import type { ShortcutId } from '../shortcuts/shortcuts';
import { useShortcut } from '../shortcuts/useShortcut';
import { useRoomViewMode } from '../navigation/useRoomViewMode';
import type { RoomViewMode } from '../navigation/roomViewMode';
import {
  hasActiveThreadFilters,
  type ThreadFilterState,
} from '../event-store/threads/roomThreadOverviewModel';
import { RoomHeaderMenu } from './RoomHeaderMenu';
import { CompactViewIcon } from './CompactViewIcon';
import { HeaderActionButton, HeaderTopic } from './RoomViewHeader.css';
import * as css from './RoomViewHeaderLayout.css';

export type RoomViewHeaderProps = {
  hasMindroomAgents?: boolean;
  joinRequestCount?: number;
  /** The open thread, if any: the room's view switch does not apply inside a thread. */
  threadId?: string;
  /** The room's thread filters: the filter button marks them while their bar is hidden. */
  threadFilterState?: ThreadFilterState;
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
  buttonProps?: Record<`data-${string}` | `aria-${string}`, string | boolean | undefined>;
  /** The keyboard shortcut for the same action, shown in the tooltip. */
  shortcut?: ShortcutId;
};

/** An icon-only header button that names itself in a tooltip, as screen readers hear it. */
function HeaderAction({
  label,
  icon,
  onClick,
  pressed,
  active,
  badge,
  buttonProps,
  shortcut,
}: HeaderActionProps) {
  return (
    <TooltipProvider
      position="Bottom"
      offset={4}
      tooltip={
        <Tooltip>
          <ShortcutLabel label={label} id={shortcut} size="T200" />
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
          className={HeaderActionButton}
          style={badge ? { position: 'relative' } : undefined}
          {...shortcutAttributes(shortcut)}
          {...buttonProps}
        >
          <Icon size="400" src={icon} />
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

// A dot on the filter button's top end corner: filters apply while their bar is hidden.
const hiddenFiltersDotStyle = {
  position: 'absolute',
  top: toRem(6),
  insetInlineEnd: toRem(6),
  minWidth: toRem(8),
  height: toRem(8),
  padding: 0,
  pointerEvents: 'none',
} as const;

const rectOf = (event: MouseEvent<HTMLElement>): RectCords => {
  const { x, y, width, height } = event.currentTarget.getBoundingClientRect();
  return { x, y, width, height };
};

/** The list a phone's back button leads to from a room the app did not open itself. */
const sectionPathOf = (spacePathId: string | undefined, isDirect: boolean): string => {
  if (spacePathId) return getSpacePath(spacePathId);
  return isDirect ? getDirectPath() : getHomePath();
};

/**
 * The room's view and its Compact and Threads switch: Compact shows threads as cards, Threads the
 * room's roots with a chip for each thread. Classic stays a stored choice (or Jump to Time); from
 * it the switch goes to Compact.
 */
const useViewSwitch = (room: Room, hasMindroomAgents: boolean | undefined) => {
  const { viewMode, setViewMode, availableViewModes } = useRoomViewMode(
    room.roomId,
    hasMindroomAgents
  );
  const fullMode: RoomViewMode | undefined = availableViewModes.includes('threaded')
    ? 'threaded'
    : availableViewModes.find((mode) => mode !== 'compact');
  if (!availableViewModes.includes('compact') || fullMode === undefined) {
    return { viewMode, viewSwitch: undefined };
  }
  const compact = viewMode === 'compact';
  return {
    viewMode,
    viewSwitch: { compact, toggle: () => setViewMode(compact ? fullMode : 'compact') },
  };
};

/**
 * The room header: avatar (a back button on phones), name and topic, then the Compact and Threads
 * switch, the filter bar button, scheduled tasks, canvases, the computer, calls, pinned messages,
 * members and the room menu. Phones keep the back button, the name and the room menu, which offers
 * the rest, so a long name keeps its room; a call that is on keeps its button.
 */
export function RoomViewHeader({
  hasMindroomAgents,
  joinRequestCount = 0,
  threadId,
  threadFilterState,
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
  const { viewMode, viewSwitch } = useViewSwitch(room, hasMindroomAgents);
  const [filterBarHidden, setFilterBarHidden] = useSetting(settingsAtom, 'hideThreadFilterBar');
  // The views with a thread filter bar, as MindroomRoomTimeline draws it: Compact cards, and
  // Threads in a room with agents.
  const hasFilterBar =
    !threadId && (viewMode === 'compact' || (viewMode === 'threaded' && !!hasMindroomAgents));
  const hiddenFiltersActive =
    filterBarHidden && !!threadFilterState && hasActiveThreadFilters(threadFilterState);
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
  // A phone's back leaves the room for the page it was opened from (the list, a lobby, search
  // results, the room a notification opened over, a thread with a link), passing over the room's
  // own pages: its threads and the messages it was opened at. Opened from outside the app, the
  // list takes the room's place.
  const leaveRoom = () => {
    const addresses = [room.roomId, getCanonicalAliasOrRoomId(mx, room.roomId)];
    const origin = previousHistoryOrigin((page) => !showsRoom(page, addresses));
    if (origin) navigate(-origin.steps);
    else navigate(sectionPath, { replace: true });
  };

  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const [pinAnchor, setPinAnchor] = useState<RectCords>();
  // On phones the room menu opens these; they stay with the room they were opened in.
  const [canvasMenuAnchor, setCanvasMenuAnchor] = useState<RectCords>();
  const [schedulesRoomId, setSchedulesRoomId] = useState<string>();
  const [prompt, setPrompt] = useState<'invite' | 'leave' | 'jumpToTime'>();
  // The prompts open from an entry of the menu, which is gone once they close; lib/overlayFocus.ts
  // then gives focus back to the menu's button.
  const closePrompt = () => setPrompt(undefined);

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
  useShortcut('members', () => {
    toggleMembers();
    return true;
  });
  const membersLabel = membersVisible
    ? t('mindroomUi.threads.mindroomRoomViewHeader.hideMembers')
    : t('mindroomUi.threads.mindroomRoomViewHeader.showMembers');
  // Only someone who can let people in (invite) or turn them away (kick) acts on join requests.
  const canAnswerJoinRequests =
    permissions.action('invite', myUserId) || permissions.action('kick', myUserId);
  const pendingRequests = canAnswerJoinRequests ? joinRequestCount : 0;
  const membersEntryLabel =
    pendingRequests > 0
      ? t('featureUi.room.pendingJoinRequests.accessibleLabel', {
          baseLabel: membersLabel,
          count: pendingRequests,
        })
      : membersLabel;

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

  // A phone's header keeps only the back button, the name and the room menu: the menu takes the
  // room's other actions first, each closing it before it acts where the menu's button was.
  const fromMenu = (act: (menuButton: RectCords | undefined) => void) => () => {
    const menuButton = menuAnchor;
    setMenuAnchor(undefined);
    act(menuButton);
  };
  const canvasesHere = showCanvases && canvases ? canvases : [];
  const canvasShownHere = canvasesHere.some((canvas) => canvas.canvasId === openCanvasId);
  const chooseCanvas = (canvasId: string) => {
    setCanvasMenuAnchor(undefined);
    if (canvasId === openCanvasId) onCanvasClose?.();
    else onCanvasOpen?.(canvasId);
  };
  let canvasEntryLabel = t('mindroomUi.threads.mindroomRoomViewHeader.canvases');
  if (canvasesHere.length === 1) {
    canvasEntryLabel = canvasShownHere
      ? t('mindroomUi.threads.mindroomRoomViewHeader.hideCanvas')
      : t('mindroomUi.threads.mindroomRoomViewHeader.showCanvas');
  }
  // A menu checkbox that is on shows a check where its icon would be.
  const checkMark = <Icon size="100" src={Icons.Check} />;
  const phoneEntries = mobile && (
    <>
      {viewSwitch && !threadId && (
        <MenuEntry
          role="menuitemcheckbox"
          aria-checked={viewSwitch.compact}
          icon={CompactViewIcon}
          after={viewSwitch.compact ? checkMark : undefined}
          label={t('mindroomUi.threads.mindroomRoomViewHeader.compactView')}
          data-room-view-switch=""
          onSelect={fromMenu(viewSwitch.toggle)}
        />
      )}
      {hasFilterBar && (
        <MenuEntry
          role="menuitemcheckbox"
          aria-checked={!filterBarHidden}
          icon={Icons.Filter}
          after={filterBarHidden ? undefined : checkMark}
          label={
            hiddenFiltersActive
              ? t('mindroomUi.threads.mindroomRoomViewHeader.threadFiltersActive')
              : t('mindroomUi.threads.roomThreadOverview.threadFilters')
          }
          data-thread-filter-bar-toggle=""
          onSelect={fromMenu(() => setFilterBarHidden(!filterBarHidden))}
        />
      )}
      {hasMindroomAgents && (
        <RoomSchedulesMenuEntry
          room={room}
          onSelect={fromMenu(() => setSchedulesRoomId(room.roomId))}
        />
      )}
      {canvasesHere.length > 0 && (
        <MenuEntry
          icon={Icons.Category}
          label={canvasEntryLabel}
          aria-haspopup={canvasesHere.length > 1 ? 'menu' : undefined}
          onSelect={fromMenu((menuButton) => {
            const [only] = canvasesHere;
            if (canvasesHere.length > 1) setCanvasMenuAnchor(menuButton);
            else if (only) chooseCanvas(only.canvasId);
          })}
        />
      )}
      {pinnedCount > 0 && (
        <MenuEntry
          icon={Icons.Pin}
          label={t('mindroomUi.threads.mindroomRoomViewHeader.pinnedMessages')}
          aria-haspopup="dialog"
          onSelect={fromMenu(setPinAnchor)}
        />
      )}
      <MenuEntry icon={Icons.User} label={membersEntryLabel} onSelect={fromMenu(toggleMembers)} />
    </>
  );

  return (
    // Inside the main landmark a header is no banner by itself; the room's title bar stays one,
    // the landmark that names the open room.
    <PageHeader role="banner" className={css.Header} balance={mobile}>
      {/* On phones the title follows the back chevron's touch target directly. */}
      <Box grow="Yes" alignItems="Center" gap={mobile ? '0' : '300'} style={{ minWidth: 0 }}>
        {mobile ? (
          <PhoneBackButton onBack={leaveRoom} />
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
          <Text as="h1" size="H5" truncate {...ownDirectionLine}>
            {roomName}
          </Text>
          {topic && (
            <button
              type="button"
              className={classNames(HeaderTopic, css.Topic)}
              onClick={() => setTopicOpen(true)}
            >
              <Text as="span" size="T200" priority="300" truncate {...ownDirectionLine}>
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
      {/* A small gap, so a tinted button never touches its neighbour. */}
      <Box shrink="No" alignItems="Center" gap="100">
        {viewSwitch && !threadId && !mobile && (
          <HeaderAction
            label={t('mindroomUi.threads.mindroomRoomViewHeader.compactView')}
            icon={CompactViewIcon}
            pressed={viewSwitch.compact}
            active={viewSwitch.compact}
            onClick={viewSwitch.toggle}
            buttonProps={{ 'data-room-view-switch': '' }}
          />
        )}
        {hasFilterBar && !mobile && (
          <HeaderAction
            label={
              hiddenFiltersActive
                ? t('mindroomUi.threads.mindroomRoomViewHeader.threadFiltersActive')
                : t('mindroomUi.threads.roomThreadOverview.threadFilters')
            }
            icon={Icons.Filter}
            // A plain button: the bar itself shows whether it is on; the dot marks hidden filters.
            pressed={!filterBarHidden}
            onClick={() => setFilterBarHidden(!filterBarHidden)}
            badge={
              hiddenFiltersActive && (
                <Badge
                  style={hiddenFiltersDotStyle}
                  size="200"
                  variant="Primary"
                  fill="Solid"
                  radii="Pill"
                  aria-hidden="true"
                  data-hidden-filters-dot=""
                />
              )
            }
            buttonProps={{ 'data-thread-filter-bar-toggle': '' }}
          />
        )}
        {hasMindroomAgents && !mobile && (
          <RoomSchedulesButton
            room={room}
            onOpenThread={(scheduledThreadId) => navigateRoomThread(room.roomId, scheduledThreadId)}
          />
        )}
        {showCanvases && !mobile && (
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
        {pinnedCount > 0 && !mobile && (
          <HeaderAction
            label={t('mindroomUi.threads.mindroomRoomViewHeader.pinnedMessages')}
            icon={Icons.Pin}
            onClick={(event) => setPinAnchor(rectOf(event))}
            buttonProps={{ 'aria-haspopup': 'dialog', 'aria-expanded': !!pinAnchor }}
          />
        )}
        {!mobile && (
          <HeaderAction
            label={membersEntryLabel}
            icon={Icons.User}
            onClick={() => toggleMembers()}
            shortcut="members"
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
        )}
        <HeaderAction
          label={t('mindroomUi.threads.mindroomRoomViewHeader.moreOptions')}
          icon={Icons.VerticalDots}
          onClick={(event) => setMenuAnchor(rectOf(event))}
          buttonProps={{ 'aria-haspopup': 'menu', 'aria-expanded': !!menuAnchor }}
          // On phones a dot marks what the menu now holds: join requests or hidden active filters.
          badge={
            mobile &&
            (pendingRequests > 0 || hiddenFiltersActive) && (
              <Badge
                style={hiddenFiltersDotStyle}
                size="200"
                variant="Primary"
                fill="Solid"
                radii="Pill"
                aria-hidden="true"
                data-room-menu-dot=""
              />
            )
          }
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
              onJumpToTime={() => setPrompt('jumpToTime')}
              onShowComputer={
                computerInMenu
                  ? () => {
                      if (!computerOpen) onComputerToggle?.();
                    }
                  : undefined
              }
              roomEntries={phoneEntries || undefined}
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
      {mobile && canvasesHere.length > 1 && (
        <CanvasMenu
          anchor={canvasMenuAnchor}
          canvases={canvasesHere}
          openCanvasId={openCanvasId}
          onChoose={chooseCanvas}
          requestClose={() => setCanvasMenuAnchor(undefined)}
        />
      )}
      {mobile && hasMindroomAgents && schedulesRoomId === room.roomId && (
        <RoomSchedulesOverlay
          room={room}
          onClose={() => setSchedulesRoomId(undefined)}
          onOpenThread={(scheduledThreadId) => navigateRoomThread(room.roomId, scheduledThreadId)}
        />
      )}
      {prompt === 'invite' && <InviteUserPrompt room={room} requestClose={closePrompt} />}
      {prompt === 'jumpToTime' && (
        <JumpToTime room={room} threadId={threadId} requestClose={closePrompt} />
      )}
      {prompt === 'leave' && (
        <LeaveRoomPrompt
          roomId={room.roomId}
          requestClose={closePrompt}
          onLeft={() => {
            setPrompt(undefined);
            navigate(sectionPath);
          }}
        />
      )}
    </PageHeader>
  );
}
