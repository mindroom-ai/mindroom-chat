import { Fragment, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import FocusTrap from 'focus-trap-react';
import { useAtomValue } from 'jotai';
import classNames from 'classnames';
import type { Room } from 'matrix-js-sdk';
import { Avatar, Badge, Box, Icons, Text, toRem, type RectCords } from 'folds';
import { PopOut, ownDirectionLine, revealDirectionControls } from '../ui/directional';
import { PageHeader } from '../ui/page/Page';
import { RoomTopicViewer } from './RoomTopicViewer';
import { RoomAvatar, RoomIcon } from '../avatars/RoomAvatar';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useIsDirectRoom, useRoom } from '../matrix/hooks/useRoom';
import { useSpaceOptionally } from '../matrix/hooks/useSpace';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { useRoomAvatar, useRoomName, useRoomTopic } from '../matrix/hooks/useRoomMeta';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { usePowerLevelsContext } from '../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../matrix/hooks/useRoomPermissions';
import { usePinnedEventIds as useRoomPinnedEvents } from '../event-store/threads/useThreadPinning';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { conversationBehindPanelAtom } from '../navigation/conversationCover';
import { useSetting } from '../preferences/useSetting';
import { settingsAtom } from '../preferences/settings';
import { getCanonicalAliasOrRoomId, mxcUrlToHttp } from '../matrix/matrix';
import { nameInitials } from '../lib/common';
import { getDirectPartnerId } from '../matrix/room';
import { getDirectPath, getHomePath, getSpacePath } from '../routes/pathUtils';
import { RoomPinMenu } from '../messages/pins/RoomPinMenu';
import {
  RoomSchedulesButton,
  RoomSchedulesMenuEntry,
  RoomSchedulesOverlay,
} from '../schedules/RoomSchedulesButton';
import { CanvasHeaderButton, CanvasMenu } from '../canvas/CanvasHeaderButton';
import { MenuEntry } from '../ui/MenuEntry';
import type { CanvasListEntry } from '../canvas/canvasIndexStore';
import type { PluginHeaderAction } from '../plugins/headerActions';
import type { SidePanel } from '../plugins/sidePanels';
import { useShortcut } from '../shortcuts/useShortcut';
import { useRoomViewMode } from '../navigation/useRoomViewMode';
import type { RoomViewMode } from '../navigation/roomViewMode';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import {
  hasActiveThreadFilters,
  type ThreadFilterState,
} from '../event-store/threads/roomThreadOverviewModel';
import { RoomActionsMenu, useRoomActionDialog } from './RoomActionsMenu';
import { CompactViewIcon } from './CompactViewIcon';
import {
  HeaderActionButton,
  HeaderActionEntry,
  drawnByHeader,
  showsInRow,
  type RoomHeaderAction,
  type RoomHeaderEntry,
} from './roomHeaderActions';
import { HeaderTopic } from './RoomViewHeader.css';
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
  canvases?: CanvasListEntry[];
  openCanvasId?: string;
  onCanvasOpen?: (canvasId: string) => void;
  onCanvasClose?: () => void;
  /** The call controls, which the room provides (`HeaderCallButtons`) for where they go. */
  calls?: (placement: HeaderCallPlacement) => ReactNode;
  /**
   * The side panel beside the room or across it, by id (src/app/ui/panels/roomPanels.ts); none
   * while the one open is folded to its tab.
   */
  shownPanel?: string;
  /**
   * Opens the members or a plugin's panel by the room's rule, unfolds it while it is folded, or
   * closes it while it shows.
   */
  onPanelToggle?: (id: string) => void;
  /** The plugins' side panels, each toggled from the row or the room menu by its placement. */
  pluginPanels?: readonly Pick<SidePanel, 'id' | 'label' | 'icon' | 'placement'>[];
  /** The plugins' header actions, each in the row or the room menu by its placement. */
  pluginActions?: readonly PluginHeaderAction[];
  /**
   * On phones with a thread open, receives the element the thread's bar goes in: RoomView portals
   * ThreadContextBanner there from inside the thread's approvals. It takes the room name's place,
   * and the top bar's above it, so a thread has one bar. Wider screens ignore it.
   */
  threadBarSlot?: (element: HTMLElement | null) => void;
};

/**
 * Where the header puts the call controls: its row of buttons, or on phones also the room menu,
 * since a phone's header has no room for them beside the name.
 */
export type HeaderCallPlacement =
  | { at: 'header'; phone: boolean }
  | { at: 'menu'; requestClose: () => void };

// On the Members button's top end corner, out of the pointer's way.
const joinRequestBadgeStyle = {
  position: 'absolute',
  top: 0,
  insetInlineEnd: 0,
  pointerEvents: 'none',
} as const;

// A dot on a button's top end corner, out of the pointer's way; `marker` names it for tests.
const dotStyle = {
  position: 'absolute',
  top: toRem(6),
  insetInlineEnd: toRem(6),
  minWidth: toRem(8),
  height: toRem(8),
  padding: 0,
  pointerEvents: 'none',
} as const;
const cornerDot = (marker: `data-${string}`) => (
  <Badge
    style={dotStyle}
    size="200"
    variant="Primary"
    fill="Solid"
    radii="Pill"
    aria-hidden="true"
    {...{ [marker]: '' }}
  />
);

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
 * The room header: avatar, name and topic, then its actions (the Compact and Threads switch, the
 * filter bar button, scheduled tasks, canvases, the computer, calls, pinned messages, members, and
 * the plugins' actions) and the room menu, which offers those its row leaves out. Phones keep the
 * name and the room menu, so a long name keeps its room; a call that is on keeps its button. The
 * room list is in a phone's drawer, behind the top bar's menu button, so the header has no way
 * back. With a thread open, a phone's header is the thread's bar, the row's buttons and the room
 * menu.
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
  canvases,
  openCanvasId,
  onCanvasOpen,
  onCanvasClose,
  calls,
  shownPanel,
  onPanelToggle,
  pluginPanels = [],
  pluginActions = [],
  threadBarSlot,
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
  const { navigateRoomThread } = useRoomNavigate();
  const pinnedCount = useRoomPinnedEvents(room).length;
  const authenticatedMedia = useMediaAuthentication();
  const permissions = useRoomPermissions(useRoomCreators(room), usePowerLevelsContext());
  const myUserId = mx.getSafeUserId();

  // Spaces and direct chats are addressed like their links: by canonical alias when there is one.
  const space = useSpaceOptionally();
  const spacePathId = space ? getCanonicalAliasOrRoomId(mx, space.roomId) : undefined;
  const direct = useIsDirectRoom();
  const sectionPath = sectionPathOf(spacePathId, direct);
  // Not while a side panel in the conversation's place hides this header: its Members shortcut
  // waits.
  const behindPanel = useAtomValue(conversationBehindPanelAtom);
  const [menuAnchor, setMenuAnchor] = useState<RectCords>();
  const [pinAnchor, setPinAnchor] = useState<RectCords>();
  // On phones the room menu opens these; they stay with the room they were opened in.
  const [canvasMenuAnchor, setCanvasMenuAnchor] = useState<RectCords>();
  const [schedulesRoomId, setSchedulesRoomId] = useState<string>();
  // The dialogs open from an entry of the menu, which is gone once they close; lib/overlayFocus.ts
  // then gives focus back to the menu's button.
  const { dialog, showDialog } = useRoomActionDialog();

  // A direct chat shows the other person, by picture or initial.
  const pictureMxc = useRoomAvatar(room, direct);
  // Twice the 36 px avatar, so it stays sharp on high-density screens.
  const avatarSrc = pictureMxc
    ? mxcUrlToHttp(mx, pictureMxc, authenticatedMedia, 72, 72, 'crop') ?? undefined
    : undefined;
  // Direction controls in the name and topic show as code points, so they cannot reorder them.
  const roomName = revealDirectionControls(useRoomName(room));
  const roomTopic = useRoomTopic(room);
  const topic = roomTopic && revealDirectionControls(roomTopic);
  const [topicOpen, setTopicOpen] = useState(false);

  // A thread's actions are behind its bar's title; the room menu stays after it, for what acts on
  // the open conversation (Jump to Time, the computer, canvases, the plugins' panels and actions).
  const phoneThreadBar =
    mobile && threadBarSlot ? (
      <div ref={threadBarSlot} className={css.ThreadBarSlot} data-phone-thread-bar-slot="true" />
    ) : undefined;

  const membersVisible = shownPanel === 'members';
  const toggleMembers = () => onPanelToggle?.('members');
  useShortcut('members', () => {
    if (behindPanel) return false;
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

  const canToggleComputer = !!computerAvailable && !!onComputerToggle;
  const showCanvases = !!canvases && !!onCanvasOpen && !!onCanvasClose;

  // An action in the room menu closes it before it acts where the menu's button was.
  const closeMenu = () => setMenuAnchor(undefined);
  const fromMenu = (act: (menuButton: RectCords | undefined) => void) => () => {
    const menuButton = menuAnchor;
    closeMenu();
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
  const openScheduledThread = (scheduledThreadId: string) =>
    navigateRoomThread(room.roomId, scheduledThreadId);

  // The header's actions, in the order of its row; the room menu takes, in the same order, those
  // that do not fit (showsInRow).
  const listed: (RoomHeaderEntry | false | undefined)[] = [
    viewSwitch &&
      !threadId && {
        id: 'viewSwitch',
        label: t('mindroomUi.threads.mindroomRoomViewHeader.compactView'),
        icon: CompactViewIcon,
        placement: 'auto',
        pressed: viewSwitch.compact,
        active: viewSwitch.compact,
        run: viewSwitch.toggle,
        marker: 'data-room-view-switch',
      },
    hasFilterBar && {
      id: 'filterBar',
      label: hiddenFiltersActive
        ? t('mindroomUi.threads.mindroomRoomViewHeader.threadFiltersActive')
        : t('mindroomUi.threads.roomThreadOverview.threadFilters'),
      icon: Icons.Filter,
      placement: 'auto',
      // Not tinted: the bar itself shows whether it is on; the dot marks hidden filters.
      pressed: !filterBarHidden,
      run: () => setFilterBarHidden(!filterBarHidden),
      badge: hiddenFiltersActive && cornerDot('data-hidden-filters-dot'),
      marker: 'data-thread-filter-bar-toggle',
    },
    hasMindroomAgents && {
      id: 'schedules',
      placement: 'auto',
      row: <RoomSchedulesButton room={room} onOpenThread={openScheduledThread} />,
      menu: (
        <RoomSchedulesMenuEntry
          room={room}
          onSelect={fromMenu(() => setSchedulesRoomId(room.roomId))}
        />
      ),
    },
    showCanvases &&
      canvases.length > 0 && {
        id: 'canvas',
        placement: 'auto',
        row: (
          <CanvasHeaderButton
            canvases={canvases}
            openCanvasId={openCanvasId}
            onOpen={onCanvasOpen}
            onClose={onCanvasClose}
          />
        ),
        menu: (
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
        ),
      },
    canToggleComputer && {
      id: 'computer',
      label: computerOpen
        ? t('mindroomUi.threads.mindroomRoomViewHeader.hideComputer')
        : t('mindroomUi.threads.mindroomRoomViewHeader.showComputer'),
      icon: Icons.Monitor,
      // A button once the computer was shown, until then an entry of the room menu.
      placement: computerShown || computerOpen ? 'auto' : 'menu',
      active: !!computerOpen,
      run: () => onComputerToggle?.(),
    },
    // The call buttons, which on phones keep only a call that is on (HeaderCallButtons).
    calls && { id: 'call', placement: 'row', row: calls({ at: 'header', phone: mobile }) },
    pinnedCount > 0 && {
      id: 'pins',
      label: t('mindroomUi.threads.mindroomRoomViewHeader.pinnedMessages'),
      icon: Icons.Pin,
      placement: 'auto',
      popup: 'dialog',
      expanded: !!pinAnchor,
      run: setPinAnchor,
    },
    {
      id: 'members',
      label: membersEntryLabel,
      icon: Icons.User,
      placement: 'auto',
      shortcut: 'members',
      badge: pendingRequests > 0 && (
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
      ),
      run: toggleMembers,
    },
    ...pluginPanels.map(
      ({ id, label, icon = Icons.Bulb, placement = 'menu' }): RoomHeaderAction => ({
        id: `panel:${id}`,
        label,
        icon,
        placement,
        pressed: shownPanel === id,
        active: shownPanel === id,
        run: () => onPanelToggle?.(id),
      })
    ),
    ...pluginActions.map(
      ({ id, label, icon, placement, run }): RoomHeaderAction => ({
        id: `action:${id}`,
        label,
        icon,
        placement,
        // A thread whose root the server has not confirmed yet has no id a plugin could use.
        run: () =>
          run({
            roomId: room.roomId,
            threadId: isConfirmedMatrixEventId(threadId) ? threadId : undefined,
          }),
      })
    ),
    // The room menu's call entries, for what a phone's row leaves out of the call buttons.
    calls && {
      id: 'callEntries',
      placement: 'auto',
      menu: calls({ at: 'menu', requestClose: closeMenu }),
    },
  ];
  const entries = listed.filter((entry): entry is RoomHeaderEntry => !!entry);
  const inRow = (entry: RoomHeaderEntry) => showsInRow(entry.placement, mobile);
  const menuEntries = entries.filter((entry) => !inRow(entry));
  // What only works in the open room, before the room's own actions in the menu.
  const roomEntries =
    menuEntries.length > 0 &&
    menuEntries.map((entry) =>
      drawnByHeader(entry) ? (
        <HeaderActionEntry key={entry.id} action={entry} onSelect={fromMenu(entry.run)} />
      ) : (
        <Fragment key={entry.id}>{entry.menu}</Fragment>
      )
    );

  return (
    // Inside the main landmark a header is no banner by itself; the room's title bar stays one,
    // the landmark that names the open room.
    // A thread's bar starts with its back chevron, whose touch target overhangs a balanced header.
    <PageHeader role="banner" className={css.Header} balance={!!phoneThreadBar}>
      {phoneThreadBar ?? (
        <Box grow="Yes" alignItems="Center" gap="300" style={{ minWidth: 0 }}>
          {!mobile && (
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
      )}
      {/* A small gap, so a tinted button never touches its neighbour. */}
      <Box shrink="No" alignItems="Center" gap="100">
        {entries
          .filter(inRow)
          .map((entry) =>
            drawnByHeader(entry) ? (
              <HeaderActionButton key={entry.id} action={entry} />
            ) : (
              <Fragment key={entry.id}>{entry.row}</Fragment>
            )
          )}
        <HeaderActionButton
          action={{
            label: t('mindroomUi.threads.mindroomRoomViewHeader.moreOptions'),
            icon: Icons.VerticalDots,
            popup: 'menu',
            expanded: !!menuAnchor,
            run: setMenuAnchor,
            // A dot marks what the menu holds that a button would show: join requests or hidden
            // active filters, on phones.
            badge:
              menuEntries.some((entry) => drawnByHeader(entry) && !!entry.badge) &&
              cornerDot('data-room-menu-dot'),
          }}
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
                closeMenu();
                return true;
              },
              escapeDeactivates: () => {
                closeMenu();
                return true;
              },
            }}
          >
            <RoomActionsMenu
              room={room}
              spaceId={space?.roomId}
              threadId={threadId}
              submenuSide="Left"
              close={closeMenu}
              showDialog={showDialog}
              onLeft={() => navigate(sectionPath)}
              roomEntries={roomEntries}
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
      {dialog}
    </PageHeader>
  );
}
