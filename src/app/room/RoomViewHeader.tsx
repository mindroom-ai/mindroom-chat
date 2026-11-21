import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import FocusTrap from 'focus-trap-react';
import { useAtomValue } from 'jotai';
import classNames from 'classnames';
import type { Room } from 'matrix-js-sdk';
import { Avatar, Badge, Box, Icons, Text, config, toRem } from 'folds';
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
import { useToolCallsShown } from '../messages/toolCallVisibility';
import { settingsAtom } from '../preferences/settings';
import { getCanonicalAliasOrRoomId, mxcUrlToHttp } from '../matrix/matrix';
import { nameInitials } from '../lib/common';
import { getDirectPartnerId } from '../matrix/room';
import { useParentRooms } from '../matrix/state/subRooms';
import { getDirectPath, getHomePath, getSpacePath } from '../routes/pathUtils';
import { RoomPinMenu } from '../messages/pins/RoomPinMenu';
import { subagentConversation, useRoomSubagentCounts } from '../messages/live/subagentRunStore';
import { SubagentsIcon } from '../subagents/SubagentsIcon';
import {
  RoomSchedulesButton,
  RoomSchedulesMenuEntry,
  RoomSchedulesOverlay,
  usePendingRoomSchedules,
} from '../schedules/RoomSchedulesButton';
import { getRoomScheduleCount } from '../schedules/roomSchedules';
import { CanvasHeaderButton, CanvasMenu } from '../canvas/CanvasHeaderButton';
import { MenuEntry } from '../ui/MenuEntry';
import type { CanvasListEntry } from '../canvas/canvasIndexStore';
import type { PluginHeaderAction } from '../plugins/headerActions';
import type { SidePanel } from '../plugins/sidePanels';
import { useShortcut } from '../shortcuts/useShortcut';
import { useRoomViewMode } from '../navigation/useRoomViewMode';
import type { RoomViewMode } from '../navigation/roomViewMode';
import { useRoomCommands } from '../navigation/roomCommands';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import {
  hasChosenThreadFilters,
  type ThreadFilterState,
} from '../event-store/threads/roomThreadOverviewModel';
import { RoomActionsMenu, useRoomActionDialog } from './RoomActionsMenu';
import { CompactViewIcon } from './CompactViewIcon';
import {
  HeaderActionButton,
  HeaderActionEntry,
  drawnByHeader,
  headerPopupAnchor,
  showsInRow,
  type HeaderPopupAnchor,
  type RoomHeaderAction,
  type RoomHeaderEntry,
} from './roomHeaderActions';
import { selectPhoneHeaderActions, usePhoneHeaderSlots } from './phoneHeaderActions';
import { HeaderTopic } from './RoomViewHeader.css';
import * as css from './RoomViewHeaderLayout.css';

export type RoomViewHeaderProps = {
  hasMindroomAgents?: boolean;
  joinRequestCount?: number;
  /** The open thread, if any: the room's view switch does not apply inside a thread. */
  threadId?: string;
  /**
   * The thread the page has open, also in its column beside the room's messages, where `threadId`
   * names none: the plugins' actions run in it.
   */
  openThreadId?: string;
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
  calls?: ReactElement;
  /**
   * The side panel beside the room or across it, by id (src/app/ui/panels/roomPanels.ts); none
   * while the one open is folded to its tab.
   */
  shownPanel?: string;
  /**
   * Opens the members, the sub-agents or a plugin's panel by the room's rule, unfolds it while it
   * is folded, or closes it while it shows.
   */
  onPanelToggle?: (id: string) => void;
  /** The plugins' side panels, each toggled from the row or the room menu by its placement. */
  pluginPanels?: readonly Pick<SidePanel, 'id' | 'label' | 'icon' | 'placement'>[];
  /** The plugins' header actions, each in the row or the room menu by its placement. */
  pluginActions?: readonly PluginHeaderAction[];
};

// A count on a button's top end corner, out of the pointer's way, in a badge tall enough for its
// digits (the 200 size is a dot's), with room beside two of them as the 500 size has.
const countBadgeStyle = {
  position: 'absolute',
  top: 0,
  insetInlineEnd: 0,
  paddingInline: config.space.S100,
  pointerEvents: 'none',
} as const;
const cornerCount = (count: number) => (
  <Badge
    style={countBadgeStyle}
    size="400"
    variant="Primary"
    fill="Solid"
    radii="Pill"
    aria-hidden="true"
  >
    <Text as="span" size="L400">
      {count}
    </Text>
  </Badge>
);

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

/** The room's list, which the room menu's Leave goes to once the room is left. */
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
 * The room header: avatar, name and topic (only the name on phones), then its actions (the Compact and
 * Threads switch, the filter bar button, scheduled tasks, canvases, the computer, the sub-agents,
 * calls, pinned messages, members, and the plugins' actions) and the room menu, which offers those
 * its row leaves out, and whether this room shows tool calls. Phones promote a few of those
 * actions when they fit alongside the name, call buttons, and room menu. The top bar's menu
 * button, not the header, leads back to the list there.
 */
export function RoomViewHeader({
  hasMindroomAgents,
  joinRequestCount = 0,
  threadId,
  openThreadId = threadId,
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
}: RoomViewHeaderProps) {
  const room = useRoom();
  const { t } = useTranslation();
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const { layout, headerRef, callGroupRef, mandatoryTailRef } = usePhoneHeaderSlots(mobile);
  const mx = useMatrixClient();
  const { viewMode, viewSwitch } = useViewSwitch(room, hasMindroomAgents);
  const [filterBarHidden, setFilterBarHidden] = useSetting(settingsAtom, 'hideThreadFilterBar');
  const [showToolCalls, setShowToolCalls] = useToolCallsShown(room.roomId);
  // The views with a thread filter bar, as MindroomRoomTimeline draws it: Compact cards, and
  // Threads in a room with agents.
  const hasFilterBar =
    !threadId && (viewMode === 'compact' || (viewMode === 'threaded' && !!hasMindroomAgents));
  const hiddenFiltersActive =
    filterBarHidden && !!threadFilterState && hasChosenThreadFilters(threadFilterState);
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
  // A sub-room of a chat room the client has (useParentRooms: listed by it and, once joined,
  // naming it back as parent), also while the room list shows it on its own because that room is
  // hidden: the header describes the room, not where a list puts it.
  const subRoom = useParentRooms(room).length > 0;
  const sectionPath = sectionPathOf(spacePathId, direct);
  // Not while a side panel in the conversation's place hides this header: its Members shortcut
  // waits.
  const behindPanel = useAtomValue(conversationBehindPanelAtom);
  const [menuAnchor, setMenuAnchor] = useState<HeaderPopupAnchor>();
  const [pinAnchor, setPinAnchor] = useState<HeaderPopupAnchor>();
  // The header owns the chooser and schedules dialog, not the controls that open them.
  const [canvasMenuAnchor, setCanvasMenuAnchor] = useState<HeaderPopupAnchor>();
  const canvasChooserLayout = useRef({ mobile, layout });
  const focusedAction = useRef<HTMLElement>();
  const [schedules, setSchedules] = useState<{ roomId: string; opener?: HTMLButtonElement }>();
  const schedulesOpen = !!hasMindroomAgents && schedules?.roomId === room.roomId;
  const openSchedules = (opener?: HTMLButtonElement) =>
    setSchedules({ roomId: room.roomId, opener });
  const pendingSchedules = usePendingRoomSchedules(room);
  const displayedScheduleCount = getRoomScheduleCount(
    pendingSchedules,
    mobile ? openThreadId : undefined
  );
  useEffect(() => {
    if (!schedulesOpen && schedules) setSchedules(undefined);
  }, [schedulesOpen, schedules]);
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
  // Phones keep the header to the name; the topic stays in the room's settings.
  const topic = !mobile && roomTopic ? revealDirectionControls(roomTopic) : undefined;
  const [topicOpen, setTopicOpen] = useState(false);
  useEffect(() => {
    if (!topic) setTopicOpen(false);
  }, [topic]);

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
  // The Sub-agents toggle shows while the room keeps a sub-agent run (a working one, or one paused
  // or ended not long ago) started in the conversation on screen (`subagentConversation`), whose
  // runs alone the panel lists. Its count is of those runs still at it. It stays while the panel
  // shows, so a panel opened elsewhere (a sub-agent job in the jobs bar) or whose last run expired
  // can still be hidden.
  const { total: keptSubagents, active: activeSubagents } = useRoomSubagentCounts(
    room.roomId,
    subagentConversation(openThreadId, viewMode === 'classic')
  );
  const subagentsVisible = shownPanel === 'subagents';
  const subagentsLabel = subagentsVisible
    ? t('mindroomUi.subagents.hide')
    : t('mindroomUi.subagents.show');

  // Header invariant: Escape, Close and choosing an entry return to its connected opener or ⋮.
  // Outside clicks and navigation keep their own focus. Resize keeps persistent controls mounted
  // and never leaves a hidden popover able to reopen.
  const headerFocusTarget = useCallback(
    (opener?: HTMLButtonElement) =>
      opener?.isConnected
        ? opener
        : headerRef.current?.querySelector<HTMLButtonElement>('[data-room-more-options]') ?? false,
    [headerRef]
  );
  const restoreFocusAfterDismiss = useCallback(
    (anchor?: HeaderPopupAnchor) => {
      // Run after the trap has let go, unless another control already received focus.
      requestAnimationFrame(() => {
        const target = headerFocusTarget(anchor?.opener);
        if (!target) return;
        const { activeElement, body } = target.ownerDocument;
        if (!activeElement || activeElement === body) target.focus({ preventScroll: true });
      });
    },
    [headerFocusTarget]
  );
  const restoreFocusOnEscape = (event: KeyboardEvent, anchor?: HeaderPopupAnchor) => {
    event.stopPropagation();
    restoreFocusAfterDismiss(anchor);
  };

  const forgetActionFocus = ({ target, relatedTarget }: FocusEvent<HTMLDivElement>) => {
    if (relatedTarget && relatedTarget !== target.ownerDocument.body) {
      focusedAction.current = undefined;
    } else {
      queueMicrotask(() => {
        if (target.isConnected && focusedAction.current === target)
          focusedAction.current = undefined;
      });
    }
  };
  // Removing a focused node doesn't always emit focusout. Check its connection after the row commits.
  useLayoutEffect(() => {
    if (!focusedAction.current || focusedAction.current.isConnected) return;
    focusedAction.current = undefined;
    restoreFocusAfterDismiss();
  });

  // An action in the room menu closes it before it acts where the menu's button was.
  const closeMenu = () => setMenuAnchor(undefined);
  const fromMenu = (act: (menuButton: HeaderPopupAnchor | undefined) => void) => () => {
    const menuButton = menuAnchor;
    closeMenu();
    act(menuButton);
  };
  const canvasesHere = showCanvases && canvases ? canvases : [];
  const needsCanvasChooser = canvasesHere.length > 1;
  useLayoutEffect(() => {
    // The chooser's captured rect belongs to its old layout. Close it before painting the new one.
    const previous = canvasChooserLayout.current;
    const layoutChanged = previous.mobile !== mobile || previous.layout !== layout;
    canvasChooserLayout.current = { mobile, layout };
    if (!canvasMenuAnchor || (!layoutChanged && needsCanvasChooser)) return;
    setCanvasMenuAnchor(undefined);
    if (layoutChanged) restoreFocusAfterDismiss(canvasMenuAnchor);
  }, [mobile, layout, canvasMenuAnchor, needsCanvasChooser, restoreFocusAfterDismiss]);
  const canvasShownHere = canvasesHere.some((canvas) => canvas.canvasId === openCanvasId);
  const chooseCanvas = (canvasId: string, anchor?: HeaderPopupAnchor) => {
    setCanvasMenuAnchor(undefined);
    if (canvasId === openCanvasId) onCanvasClose?.();
    else onCanvasOpen?.(canvasId);
    restoreFocusAfterDismiss(anchor);
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
    // Agents' replies list the tools they ran; this room's choice, over the default in Settings.
    hasMindroomAgents && {
      id: 'toolCalls',
      label: t('mindroomUi.messages.showToolCalls'),
      icon: Icons.Terminal,
      placement: 'menu',
      pressed: showToolCalls,
      run: () => setShowToolCalls(!showToolCalls),
      marker: 'data-tool-calls-toggle',
    },
    hasMindroomAgents && {
      id: 'schedules',
      placement: 'auto',
      phoneEligible: displayedScheduleCount > 0,
      row: (
        <RoomSchedulesButton
          total={displayedScheduleCount}
          open={schedulesOpen}
          onOpen={openSchedules}
        />
      ),
      menu: (
        <RoomSchedulesMenuEntry
          total={pendingSchedules.length}
          onSelect={fromMenu((menuButton) => openSchedules(menuButton?.opener))}
        />
      ),
    },
    showCanvases &&
      canvases.length > 0 && {
        id: 'canvas',
        placement: 'auto',
        phoneEligible: true,
        row: (
          <CanvasHeaderButton
            canvases={canvases}
            openCanvasId={openCanvasId}
            onOpen={onCanvasOpen}
            onClose={onCanvasClose}
            chooser={{
              open: !!canvasMenuAnchor,
              onOpen: (opener) => setCanvasMenuAnchor(headerPopupAnchor(opener)),
            }}
          />
        ),
        menu: (
          <MenuEntry
            icon={Icons.Category}
            label={canvasEntryLabel}
            aria-haspopup={needsCanvasChooser ? 'menu' : undefined}
            onSelect={fromMenu((menuButton) => {
              const [only] = canvasesHere;
              if (needsCanvasChooser) setCanvasMenuAnchor(menuButton);
              else if (only) chooseCanvas(only.canvasId, menuButton);
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
      phoneEligible: true,
      active: !!computerOpen,
      run: () => onComputerToggle?.(),
    },
    (keptSubagents > 0 || subagentsVisible) && {
      id: 'subagents',
      label:
        activeSubagents > 0
          ? t('mindroomUi.subagents.withCount', { label: subagentsLabel, count: activeSubagents })
          : subagentsLabel,
      icon: SubagentsIcon,
      placement: 'auto',
      phoneEligible: activeSubagents > 0,
      pressed: subagentsVisible,
      active: subagentsVisible,
      badge: activeSubagents > 0 && cornerCount(activeSubagents),
      run: () => onPanelToggle?.('subagents'),
      marker: 'data-subagents-toggle',
    },
    // Keep call controls in the same group across rotation. Only phones measure its width.
    {
      id: 'call',
      placement: 'row',
      row: (
        <Box
          alignItems="Center"
          gap="100"
          ref={callGroupRef}
          className={css.CallGroup}
          data-room-header-call-group=""
        >
          {calls}
        </Box>
      ),
    },
    pinnedCount > 0 && {
      id: 'pins',
      label: t('mindroomUi.threads.mindroomRoomViewHeader.pinnedMessages'),
      icon: Icons.Pin,
      placement: 'auto',
      phoneEligible: true,
      popup: 'dialog',
      expanded: !!pinAnchor,
      run: setPinAnchor,
    },
    {
      id: 'members',
      label: membersEntryLabel,
      icon: Icons.User,
      placement: 'auto',
      phoneEligible: true,
      shortcut: 'members',
      focusFallback: () => headerFocusTarget(),
      badge: pendingRequests > 0 && cornerCount(pendingRequests),
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
            threadId: isConfirmedMatrixEventId(openThreadId) ? openThreadId : undefined,
          }),
      })
    ),
  ];
  const entries = listed.filter((entry): entry is RoomHeaderEntry => !!entry);
  // The command palette offers the actions the header draws, bar the ones that need their button's place.
  useRoomCommands(
    entries
      .filter(drawnByHeader)
      .filter((entry) => !entry.popup)
      .map(({ id, label, icon, pressed, shortcut, run }) => ({
        id,
        label,
        icon,
        pressed,
        shortcut,
        run: () => run(undefined),
      }))
  );
  // Freeze the last rendered promotion set until every header popover closes. Entry data still
  // updates, but eligibility changes cannot move entries between the row and the menu.
  const popoverOpen = !!(
    menuAnchor ||
    pinAnchor ||
    (needsCanvasChooser && canvasMenuAnchor) ||
    schedulesOpen ||
    (topic && topicOpen) ||
    dialog
  );
  const lastPromoted = useRef<ReadonlySet<string>>();
  const promoted =
    (popoverOpen ? lastPromoted.current : undefined) ??
    selectPhoneHeaderActions(
      mobile ? layout.slots : 0,
      entries
        .filter((entry) => entry.placement === 'auto' && entry.phoneEligible)
        .map((entry) => entry.id)
    );
  useLayoutEffect(() => {
    if (!popoverOpen) lastPromoted.current = promoted;
  }, [popoverOpen, promoted]);
  const inRow = (entry: RoomHeaderEntry) =>
    showsInRow(entry.placement, mobile, promoted.has(entry.id));
  const rowEntries = entries.filter(inRow);
  // Plugins keep their original order on desktop and the same parent at either width. On phones
  // only mandatory plugin controls reach this group, so promotions cannot affect its measurement.
  const inMandatoryTail = ({ id }: RoomHeaderEntry) =>
    id.startsWith('panel:') || id.startsWith('action:');
  const drawRowEntry = (entry: RoomHeaderEntry) =>
    drawnByHeader(entry) ? (
      <HeaderActionButton key={entry.id} action={entry} />
    ) : (
      <Fragment key={entry.id}>{entry.row}</Fragment>
    );
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

  const moreOptions = (
    <HeaderActionButton
      action={{
        label: t('mindroomUi.threads.mindroomRoomViewHeader.moreOptions'),
        icon: Icons.VerticalDots,
        popup: 'menu',
        expanded: !!menuAnchor,
        run: setMenuAnchor,
        marker: 'data-room-more-options',
        // A dot marks what the menu holds that a button would show: join requests, active
        // sub-agents or hidden active filters, on phones.
        badge:
          menuEntries.some((entry) => drawnByHeader(entry) && !!entry.badge) &&
          cornerDot('data-room-menu-dot'),
      }}
    />
  );

  return (
    // Inside the main landmark a header is no banner by itself; the room's title bar stays one,
    // the landmark that names the open room.
    <PageHeader ref={headerRef} role="banner" className={css.Header}>
      {/* On phones the name leads: the top bar's menu button above it reaches the list. */}
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
                  <RoomIcon size="200" joinRule={room.getJoinRule()} filled subRoom={subRoom} />
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
      <Box
        shrink="No"
        alignItems="Center"
        gap="100"
        onFocus={({ target, currentTarget }: FocusEvent<HTMLDivElement>) => {
          if (currentTarget.contains(target)) focusedAction.current = target;
        }}
        onBlur={forgetActionFocus}
      >
        {rowEntries.filter((entry) => !inMandatoryTail(entry)).map(drawRowEntry)}
        <Box
          alignItems="Center"
          gap="100"
          ref={mandatoryTailRef}
          data-room-header-mandatory-tail=""
        >
          {rowEntries.filter(inMandatoryTail).map(drawRowEntry)}
          {moreOptions}
        </Box>
      </Box>
      <PopOut
        anchor={pinAnchor?.rect}
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
              escapeDeactivates: (event: KeyboardEvent) => {
                setPinAnchor(undefined);
                restoreFocusOnEscape(event, pinAnchor);
                return true;
              },
            }}
          >
            <RoomPinMenu
              room={room}
              requestClose={(reason) => {
                setPinAnchor(undefined);
                if (reason === 'dismiss') restoreFocusAfterDismiss(pinAnchor);
              }}
            />
          </FocusTrap>
        }
      />
      <PopOut
        anchor={menuAnchor?.rect}
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
              escapeDeactivates: (event: KeyboardEvent) => {
                closeMenu();
                restoreFocusOnEscape(event, menuAnchor);
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
              onLeft={() => void navigate(sectionPath)}
              roomEntries={roomEntries}
            />
          </FocusTrap>
        }
      />
      {needsCanvasChooser && (
        <CanvasMenu
          anchor={canvasMenuAnchor?.rect}
          onEscape={(event) => restoreFocusOnEscape(event, canvasMenuAnchor)}
          canvases={canvasesHere}
          openCanvasId={openCanvasId}
          onChoose={(canvasId) => chooseCanvas(canvasId, canvasMenuAnchor)}
          requestClose={() => setCanvasMenuAnchor(undefined)}
        />
      )}
      {schedulesOpen && (
        <RoomSchedulesOverlay
          roomId={room.roomId}
          headerRef={headerRef}
          tasks={pendingSchedules}
          openThreadId={openThreadId}
          returnFocusTo={() => headerFocusTarget(schedules?.opener)}
          onClose={() => setSchedules(undefined)}
          onOpenThread={openScheduledThread}
        />
      )}
      {dialog}
    </PageHeader>
  );
}
