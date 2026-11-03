import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Direction, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { VirtualItem } from '@tanstack/react-virtual';
import type { Editor } from 'slate';
import {
  Box,
  Chip,
  Icon,
  Icons,
  Scroll,
  Spinner,
  Text,
  color,
  config,
  toRem,
  type IconSrc,
} from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useAlive } from '../../hooks/useAlive';
import { useIgnoredUsers } from '../../hooks/useIgnoredUsers';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useInitialClientCatchup } from '../../hooks/useInitialClientCatchup';
import {
  useVirtualPaginator,
  type ItemRange,
  type ScrollToItem,
} from '../../hooks/useVirtualPaginator';
import { useSettingValue } from '../../state/hooks/useSettingValue';
import { useRoomUnread } from '../../state/hooks/unread';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { MessageLayout, settingsAtom } from '../../state/settings';
import { getEditedEvent, getLatestMessageContent, reactionOrEditEvent } from '../../utils/room';
import { today, timeDayMonthYear, yesterday } from '../../utils/time';
import { RoomIntro } from '../../components/room-intro';
import { VirtualTile } from '../../components/virtualizer';
import * as css from '../../features/room/RoomTimeline.css';
import { InsetScrollbar } from '../../components/inset-scrollbar/InsetScrollbar';
import { mindroomSettingsAtom } from '../settings/mindroomSettings';
import { sanitizePrefetchDepth } from '../engine/prefetchPolicy';
import { scheduleReconcile, useMindroomSyncEngine } from '../engine';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import type { ScrollAnchorMemory } from '../scroll/scrollAnchorMemory';
import { CompactRoomView } from './CompactRoomView';
import { CompactThreadCount } from './CompactThreadCount';
import * as overlay from './RoomOverlay.css';
import { ThreadTimelineHeader } from './ThreadTimelineHeader';
import { TimelineMinimap } from './TimelineMinimap';
import { useTimelineMessageFeature } from './message-rendering/useTimelineMessageFeature';
import type { TimelineMessageData, TimelineMessageRow } from './message-rendering/types';
import { getRenderableEventEntries, type TimelineEventEntry } from './roomTimelineEvents';
import { buildClassicRoomRowEntries } from './roomTimelineClassicRows';
import type { RoomViewMode } from './roomViewMode';
import type { ThreadFilterState } from './roomThreadOverviewModel';
import { resolveRoomTimelineViewState } from './roomTimelineViewState';
import {
  getInitialTimeline,
  getLiveTimeline,
  getRoomUnreadInfo,
  type RecalibrateFilterOpts,
  type Timeline,
} from './timelinePagination';
import { useTimelinePagination } from './timelinePaginationController';
import { useRoomPaginationCommandController } from './roomPaginationCommandController';
import { useRoomCacheHydrationController } from './roomCacheHydrationController';
import { useRoomCachedBackState } from './useRoomCachedBackState';
import { useRoomTimelineResetRelink } from './roomTimelineResetRelink';
import { useRoomTimelineWindowController } from './roomTimelineWindowController';
import { useRoomLiveRenderController } from './roomLiveRenderController';
import {
  useRoomFocusScrollController,
  type RoomTimelineFocusItem,
} from './roomFocusScrollController';
import {
  useRoomEventOpenController,
  useRoomEventRouteOpenController,
} from './roomEventOpenController';
import { useRoomTimelineNavigationController } from './roomTimelineNavigationController';
import { useTimelineReadReceiptController } from './timelineReadReceiptController';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';
import { useRoomAutomaticFill } from './roomAutomaticFill';
import { useRoomTimelineMinimap } from './useRoomTimelineMinimap';
import { useThreadAwareTimelineRefresh } from './useThreadAwareTimelineRefresh';
import { useFollowContentGrowth } from './useFollowContentGrowth';
import { useCompactCoverageBackfillController } from './compactCoverageBackfillController';
import { useCompactRootEditBackfillController } from './compactRootEditBackfillController';
import { useThreadOverviewResumeController } from './threadOverviewResumeController';
import { getLiveReplyStore } from '../live/liveReplyStore';
import { useThreadOverviewRefreshCounter } from './threadOverviewRefreshCounter';
import { useTimelineDebugTraceIds } from './timelineDebugController';
import { useMindroomThreadIndex } from './useMindroomThreadIndex';
import { useRoomThreadResolutionMap } from './useRoomThreadTags';
import { useThreadTimelineState } from './useThreadTimelineState';
import { useThreadSession } from './session/useThreadSession';
import { useThreadPagination } from './session/useThreadPagination';
import type {
  ThreadOpenRuntime,
  ThreadOpenViewportPort,
  ThreadRenderPort,
  ThreadRoute,
} from './session/threadSessionTypes';
import { useThreadBackPaginationController } from './threadBackPaginationController';
import { useThreadPrependViewport } from './useThreadPrependViewport';
import { useThreadOpenLifecycleController } from './threadOpenLifecycleController';
import { useThreadSeedPrewarmController } from './threadSeedPrewarmController';
import { useThreadGapRecovery } from './useThreadGapRecovery';
import { useThreadEditBackfillController } from './threadEditBackfillController';
import { useThreadSummaryPublishController } from './threadSummaryPublishController';
import { useThreadSummaryTimeline } from './useThreadSummaryTimeline';
import {
  ThreadConversationCostProvider,
  useThreadConversationCostSummary,
} from './useThreadConversationCost';
import {
  useThreadApprovalRowMeasurements,
  useThreadApprovalTimeline,
} from './useThreadApprovalTimeline';
import { shouldAutoPaginateThreadBack } from './threadRenderUtils';
import { estimateMessageRowHeight, estimateRoomRowHeight } from './timelineRowEstimate';
import { isScrollNearBottom, isTimelineAtLiveEnd } from './timelineScrollUtils';
import { foldTimelineRowContexts, isRowlessTimelineEvent } from './timelineRowFold';
import {
  ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE,
  THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS,
} from './preloadSettings';
import type { ThreadSummaryWriter } from './threadSummaryState';

export type RoomTimelineProps = {
  room: Room;
  eventId?: string;
  threadId?: string;
  /** Show a permalinked thread root in the room instead of opening its thread. */
  focusEventInRoom?: boolean;
  summaryMap: ReadonlyMap<string, MindroomThreadSummaryInfo>;
  onStoreThreadSummary: ThreadSummaryWriter;
  threadFilterState: ThreadFilterState;
  viewMode: RoomViewMode;
  /** Accepted from the room view; the switch itself lives in the room header. */
  onViewModeChange?: (viewMode: RoomViewMode) => void;
  roomInputRef?: RefObject<HTMLElement>;
  compactRoomScrollStateRef?: MutableRefObject<ScrollAnchorMemory>;
  editor: Editor;
  /** Called when the open thread's root cannot be loaded at all. */
  onThreadLoadError?: (threadId: string) => void;
  /** Shown above an open thread's rows, inside its scroll area. */
  threadHeader?: ReactNode;
};

type ScrollToBottomState = { count: number; smooth: boolean };

const EMPTY_EVENTS: MatrixEvent[] = [];
const EMPTY_ENTRIES: TimelineEventEntry[] = [];
const EMPTY_IDS: ReadonlySet<string> = new Set();

/**
 * Rows are priced by their content until measured (timelineRowEstimate). The Compact layout
 * prices room rows at one height, and a row the window does not know takes the comfortable one.
 */
const ROOM_ROW_ESTIMATE_PX = { compact: 96, comfortable: 68 } as const;
const THREAD_ONE_LINE_ESTIMATE_PX = { compact: 26, comfortable: 30 } as const;

/** Gestures and keys that hand the scroll position over to the reader. */
const READER_INTENT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
/** How much further from the newest row a scroll must leave the reader to count as theirs. */
const LEFT_LATEST_ROW_PX = 32;

const distanceBelowView = (element: HTMLElement): number =>
  element.scrollHeight - element.scrollTop - element.clientHeight;

/** The display settings the timeline follows, each read on its own so a change re-renders. */
const useTimelineDisplaySettings = () => ({
  hideActivity: !!useSettingValue(settingsAtom, 'hideActivity'),
  hideMembershipEvents: !!useSettingValue(settingsAtom, 'hideMembershipEvents'),
  hideNickAvatarEvents: !!useSettingValue(settingsAtom, 'hideNickAvatarEvents'),
  messageLayout: useSettingValue(settingsAtom, 'messageLayout'),
  messageSpacing: useSettingValue(settingsAtom, 'messageSpacing'),
  showHiddenEvents: !!useSettingValue(settingsAtom, 'showHiddenEvents'),
  prefetchDepth: sanitizePrefetchDepth(useSettingValue(mindroomSettingsAtom, 'prefetchDepth')),
});

/** A value read by callbacks that must keep their identity when it changes. */
const useLatestRef = <T,>(value: T): MutableRefObject<T> => {
  const ref = useRef(value);
  ref.current = value;
  return ref;
};

/** A flag that belongs to one view: switching rooms or threads clears it in that render. */
const useViewFlag = (viewKey: string) => {
  const flagRef = useRef({ viewKey, value: false });
  if (flagRef.current.viewKey !== viewKey) flagRef.current = { viewKey, value: false };
  return flagRef;
};

/**
 * A request to show the newest room row. Opening the room, Jump to Latest, a live row the reader
 * follows, and switching the view make one; it holds until the reader scrolls, so rows measured
 * later still end at the bottom. A view switch that React renders but never shows makes none.
 */
const useLatestRowRequest = ({
  initiallyActive,
  scrollElement,
  scrollToBottomCount,
  committedView,
  focusItem,
}: {
  initiallyActive: boolean;
  scrollElement: HTMLElement | null;
  scrollToBottomCount: number;
  committedView: string;
  focusItem: RoomTimelineFocusItem | undefined;
}) => {
  const requestRef = useRef(initiallyActive);
  const seenCountRef = useRef(scrollToBottomCount);
  const viewRef = useRef(committedView);
  useLayoutEffect(() => {
    if (viewRef.current === committedView) return;
    viewRef.current = committedView;
    requestRef.current = true;
  }, [committedView]);
  useLayoutEffect(() => {
    if (scrollToBottomCount === seenCountRef.current) return;
    seenCountRef.current = scrollToBottomCount;
    requestRef.current = true;
  }, [scrollToBottomCount]);
  useLayoutEffect(() => {
    // A jump to an event owns the position from here.
    if (focusItem) requestRef.current = false;
  }, [focusItem]);
  useEffect(() => {
    if (!scrollElement) return undefined;
    const release = () => {
      requestRef.current = false;
    };
    // A scroll up that also leaves more rows below the view is the reader's too (the scrollbar,
    // a script or assistive technology): the timeline's own pins scroll down, and a row above
    // the view that changes size moves the position and the content by the same amount. It
    // listens in the capture phase, ahead of the virtualizer, whose scroll handler renders
    // synchronously and so would pin the newest row again before this saw the reader's position.
    let lastTop = scrollElement.scrollTop;
    let lastBelow = distanceBelowView(scrollElement);
    const followScroll = () => {
      const top = scrollElement.scrollTop;
      const below = distanceBelowView(scrollElement);
      if (top < lastTop && below > lastBelow + LEFT_LATEST_ROW_PX) release();
      lastTop = top;
      lastBelow = below;
    };
    READER_INTENT_EVENTS.forEach((name) =>
      scrollElement.addEventListener(name, release, { passive: true })
    );
    scrollElement.addEventListener('scroll', followScroll, { capture: true, passive: true });
    return () => {
      READER_INTENT_EVENTS.forEach((name) => scrollElement.removeEventListener(name, release));
      scrollElement.removeEventListener('scroll', followScroll, { capture: true });
    };
  }, [scrollElement]);
  return requestRef;
};

const dividerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  alignItems: 'center',
  columnGap: config.space.S200,
  padding: `${config.space.S200} ${config.space.S400}`,
};

/** A date or unread separator: a label between two hairlines. */
function DividerLabel({ label, unread = false }: { label: string; unread?: boolean }) {
  const lineColor = unread ? color.Success.ContainerLine : color.SurfaceVariant.ContainerLine;
  const rule = <span style={{ height: 1, background: lineColor }} />;
  const labelColor = unread ? color.Success.Main : color.SurfaceVariant.OnContainer;
  return (
    <div role="separator" style={{ ...dividerStyle, color: labelColor }}>
      {rule}
      <Text size="L400">{label}</Text>
      {rule}
    </div>
  );
}

/** "[+all]" and "[-all]": a small bracketed toggle that unfolds or folds every long message. */
const expandAllToggleStyle: React.CSSProperties = {
  all: 'unset',
  cursor: 'pointer',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: toRem(12),
  lineHeight: toRem(18),
  padding: `0 ${config.space.S100}`,
  borderRadius: config.radii.R300,
  border: `1px solid ${color.Primary.ContainerLine}`,
  color: color.Primary.Main,
  // Rows scroll beneath it under the thread banner, so it frosts them like the banner does.
  backgroundColor: `color-mix(in srgb, ${color.Surface.Container} 72%, transparent)`,
  backdropFilter: 'blur(3px)',
  WebkitBackdropFilter: 'blur(3px)',
};

/** A pill over the timeline that takes the reader somewhere or settles the unread state. */
function FloatingAction({
  icon,
  label,
  onSelect,
  primary = false,
}: {
  icon: IconSrc;
  label: string;
  onSelect: () => void;
  primary?: boolean;
}) {
  return (
    <Chip
      onClick={onSelect}
      variant={primary ? 'Primary' : 'SurfaceVariant'}
      outlined
      radii="Pill"
      before={<Icon src={icon} size="50" />}
    >
      <Text size="L400">{label}</Text>
    </Chip>
  );
}

function DayDivider({ ts }: { ts: number }) {
  const { t } = useTranslation();
  let label = timeDayMonthYear(ts);
  if (today(ts)) label = t('mindroomUi.threads.mindroomRoomTimeline.today');
  else if (yesterday(ts)) label = t('mindroomUi.threads.mindroomRoomTimeline.yesterday');
  return <DividerLabel label={label} />;
}

/**
 * The room's message list. Compact mode shows the room's threads as cards; the threaded and
 * Full (classic) views show the room timeline, the threaded one with a thread badge under each
 * thread root and the classic one with the replies inline; inside a thread, the root and its
 * replies. Rows are virtualized, and an offset ledger keeps the reader's rows still when rows
 * land above them.
 */
export function RoomTimeline(props: RoomTimelineProps) {
  const {
    room,
    eventId,
    threadId,
    focusEventInRoom,
    summaryMap,
    onStoreThreadSummary,
    threadFilterState,
    viewMode,
    editor,
    onThreadLoadError,
    threadHeader,
  } = props;
  const mx = useMatrixClient();
  const alive = useAlive();
  const engine = useMindroomSyncEngine();
  const { sessionId } = engine;
  const { t } = useTranslation();
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const ignoredUsers = useIgnoredUsers();
  const ignoredUsersSet = useMemo(() => new Set(ignoredUsers), [ignoredUsers]);
  const {
    hideActivity,
    hideMembershipEvents,
    hideNickAvatarEvents,
    messageLayout,
    messageSpacing,
    showHiddenEvents,
    prefetchDepth,
  } = useTimelineDisplaySettings();
  const compactLayout = messageLayout === MessageLayout.Compact;
  const compactViewRequested = !threadId && viewMode === 'compact';
  // Only the compact overview waits for the client's first catch-up, so only it follows sync.
  const clientCatchingUp = useInitialClientCatchup(compactViewRequested ? mx : undefined);
  const roomUnread = !!useRoomUnread(room.roomId, roomToUnreadAtom);
  const fallbackCompactScrollStateRef = useRef<ScrollAnchorMemory>(new Map());
  const compactRoomScrollStateRef =
    props.compactRoomScrollStateRef ?? fallbackCompactScrollStateRef;

  // No filter bar shows a sort, so the threaded timeline keeps the room's order; only the
  // Compact cards sort by their latest reply.
  const viewThreadFilterState = useMemo(
    () =>
      viewMode === 'threaded' && threadFilterState.sortBy !== 'natural'
        ? { ...threadFilterState, sortBy: 'natural' as const }
        : threadFilterState,
    [threadFilterState, viewMode]
  );
  const { effectiveViewMode, focusedRoomOverviewRequested, requestedThreadFilterState } =
    resolveRoomTimelineViewState({
      eventId,
      focusEventInRoom,
      threadFilterState: viewThreadFilterState,
      threadId,
      viewMode,
    });
  const showThreadRepliesInRoom = effectiveViewMode === 'classic';
  const viewKey = `${room.roomId}|${threadId ?? ''}`;

  // References the controllers share.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  // folds' Scroll hands React a new ref callback on every render, so each commit detaches the
  // element (null) and attaches it again. Only a different element, or none left after the
  // commit, changes the state. Even an equal update re-renders the timeline while slower
  // updates wait on it, and that render attaches the element again, without end.
  const publishedScrollRef = useRef<HTMLDivElement | null>(null);
  const attachScroll = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element;
    const publishAttached = () => {
      const attached = scrollRef.current;
      if (attached === publishedScrollRef.current) return;
      publishedScrollRef.current = attached;
      setScrollElement(attached);
    };
    if (element) publishAttached();
    else queueMicrotask(publishAttached);
  }, []);
  // A new identity once the scroll area mounts, so observers built on it start over (the
  // compact view has none, and switching to the timeline mounts it later).
  const getScrollElement = useCallback(() => scrollRef.current ?? scrollElement, [scrollElement]);
  const contentRef = useRef<HTMLDivElement>(null);
  const atBottomAnchorRef = useRef<HTMLElement | null>(null);
  const roomIdRef = useLatestRef(room.roomId);
  const threadIdRef = useLatestRef(threadId);
  const scrollToBottomRef = useRef<ScrollToBottomState>({ count: 0, smooth: false });
  const prefetchDepthRef = useLatestRef(prefetchDepth);
  // The room mounts its newest rows in a window of this size and widens it as the reader scrolls.
  const windowLimit = Math.min(prefetchDepth, ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE);
  const windowLimitRef = useLatestRef(windowLimit);
  const suppressFocusPaginationRef = useRef(false);
  const roomPaginatingBackRef = useRef(false);
  const [, forceRender] = useReducer((value: number) => value + 1, 0);

  const { roomDebugTraceId, threadDebugTraceId } = useTimelineDebugTraceIds({
    eventId,
    room,
    threadId,
  });

  // Thread session: its state comes first, so indexes and viewport consumers read it this render.
  const route = useMemo<ThreadRoute>(
    () => ({ roomId: room.roomId, threadId, eventId }),
    [room.roomId, threadId, eventId]
  );
  const session = useThreadSession(route);
  const { pagination: threadPagination, bindRuntime } = useThreadPagination(
    session.commands,
    route
  );
  const backController = useThreadBackPaginationController();
  const prependViewport = useThreadPrependViewport({ controller: backController, scrollRef });

  // The room's loaded timeline and the window of it that is mounted.
  const filterOpts = useMemo<RecalibrateFilterOpts>(
    () => ({
      room,
      threadId,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      showThreadRepliesInRoom,
    }),
    [
      room,
      threadId,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      showThreadRepliesInRoom,
    ]
  );
  const filterOptsRef = useLatestRef(filterOpts);
  const recalibrateFilterOptsRef = useRef<RecalibrateFilterOpts | undefined>(filterOpts);
  recalibrateFilterOptsRef.current = filterOpts;
  // Reads the newest filters, so it changes identity only with the room.
  const buildInitialTimeline = useCallback((): Timeline => {
    const { room: filterRoom, ...filters } = filterOptsRef.current;
    return getInitialTimeline(filterRoom, windowLimitRef.current, filters);
  }, [filterOptsRef, windowLimitRef]);
  const [timeline, setTimeline] = useState<Timeline>(buildInitialTimeline);
  const [roomHasMoreCachedBack, setRoomHasMoreCachedBack] = useState(false);
  const [roomInitialCacheHydratedKey, setRoomInitialCacheHydratedKey] = useState<string>();
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useLatestRef(atBottom);
  const [focusItem, setFocusItem] = useState<RoomTimelineFocusItem>();
  const [unreadInfo, setUnreadInfo] = useState(() =>
    threadId || eventId ? undefined : getRoomUnreadInfo(room, true)
  );
  const readUptoEventIdRef = useLatestRef(unreadInfo?.readUptoEventId);

  const { overviewRefreshCounter, setOverviewRefreshCounter } = useThreadOverviewRefreshCounter(
    room,
    threadId
  );

  // Thread rows.
  const threadState = useThreadTimelineState({
    room,
    threadId,
    threadInitialCacheHydrated: session.snapshot.open.initialCacheHydrated,
    threadInitialSdkLoaded: session.snapshot.open.sdkReady,
    timelineRevision: session.snapshot.timelineRevision,
    debugTraceId: threadDebugTraceId,
  });
  const threadStateRef = useLatestRef(threadState);
  const threadEvents = threadId ? threadState.threadEvents : EMPTY_EVENTS;
  const threadEventsRef = useLatestRef(threadEvents);
  const { threadEventIndexMapRef, threadInitialRenderMode } = threadState;
  const threadEventIndexMap = threadState.threadEventIndexMap ?? threadEventIndexMapRef.current;
  const threadTailLoaded = session.snapshot.history.tailLoaded;
  const threadHasMoreCachedBack = session.snapshot.history.hasMoreCachedBack;

  // Room rows: the room timeline's own, plus in the classic view the threads' replies.
  const { roomEntries, renderableEventEntries } = useMemo(() => {
    if (threadId) return { roomEntries: EMPTY_ENTRIES, renderableEventEntries: EMPTY_ENTRIES };
    const entries = getRenderableEventEntries(
      timeline.linkedTimelines,
      room,
      undefined,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      showThreadRepliesInRoom
    );
    if (!showThreadRepliesInRoom) return { roomEntries: entries, renderableEventEntries: entries };
    const merged = buildClassicRoomRowEntries(room, entries, {
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
    });
    return { roomEntries: entries, renderableEventEntries: merged };
  }, [
    hideMembershipEvents,
    hideNickAvatarEvents,
    ignoredUsersSet,
    room,
    showHiddenEvents,
    showThreadRepliesInRoom,
    threadId,
    timeline,
  ]);
  // The newest window counts the room timeline's rows; with merged replies the same window ends
  // at the newest merged row.
  const roomEntryCount = roomEntries.length;
  const mergedEntryCount = renderableEventEntries.length;
  const windowTimeline = useMemo(() => {
    const { start, end } = timeline.range;
    if (mergedEntryCount === roomEntryCount || end !== roomEntryCount) return timeline;
    const size = end - start;
    return {
      ...timeline,
      range: { start: Math.max(mergedEntryCount - size, 0), end: mergedEntryCount },
    };
  }, [mergedEntryCount, roomEntryCount, timeline]);
  const renderableEvents = useMemo(
    () => renderableEventEntries.map(({ event }) => event),
    [renderableEventEntries]
  );

  const threadResolutionMap = useRoomThreadResolutionMap(room);
  const threadIndex = useMindroomThreadIndex({
    room,
    threadId,
    eventId,
    focusedRoomOverviewRequested,
    compactViewRequested,
    effectiveViewMode,
    linkedTimelines: timeline.linkedTimelines,
    renderableEventEntries,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    summaryMap,
    threadResolutionMap,
    currentUserId: mx.getUserId() ?? undefined,
    requestedThreadFilterState,
    // The sort-order lock belonged to the room filter bar, which this client does not have.
    threadSortFreezeState: null,
    overviewRefreshCounter,
    sessionId,
    mx,
    onStoreThreadSummary: onStoreThreadSummary as (
      threadRootId: string,
      info: MindroomThreadSummaryInfo | undefined
    ) => void,
  });

  const windowState = useRoomTimelineWindowController({
    canPaginateThreadBack: threadState.canPaginateThreadBack,
    effectiveViewMode,
    filteredRoomThreadActive: threadIndex.roomThreadFilterActive,
    filteredRoomOverviewOrderActive: threadIndex.roomOverviewOrderActive,
    lastThreadBackwardPaginationToken: threadState.threadBackwardPaginationToken,
    overviewRefreshCounter,
    overviewThreadRootIds: threadIndex.overviewThreadRootIds,
    renderableEventEntries,
    renderableEvents,
    room,
    roomSurfaceEventEntries: threadIndex.roomSurfaceEventEntries,
    roomThreadListThreads: threadIndex.roomThreadListThreads,
    prefetchDepth: windowLimit,
    threadEventsLength: threadEvents.length,
    threadHasMoreCachedBack,
    threadId,
    threadReplyCountMap: threadIndex.threadReplyCountMap,
    threadResolutionMap,
    threadTailLoaded,
    timeline: windowTimeline,
    unreadInfo,
  });
  const roomRows = threadId ? EMPTY_EVENTS : windowState.threadFilteredEvents;
  const roomRowEntries = windowState.threadFilteredEventEntries;
  const roomRowsRef = useLatestRef(roomRows);
  const { activeTimelineRange } = windowState;
  const activeRangeRef = useLatestRef(activeTimelineRange);
  const roomWindowRows = useMemo(
    () => roomRows.slice(activeTimelineRange.start, activeTimelineRange.end),
    [activeTimelineRange.end, activeTimelineRange.start, roomRows]
  );

  // A window that reached the newest row keeps reaching it when rows join without a live
  // event, such as thread replies the classic view merges in or restored history.
  const windowEndRef = useRef<{ end: number; count: number }>();
  const roomRowCount = roomRows.length;
  useLayoutEffect(() => {
    const { start, end } = activeTimelineRange;
    const previous = windowEndRef.current;
    windowEndRef.current = { end, count: roomRowCount };
    const reachedEnd = previous ? previous.end >= previous.count : !eventId;
    if (threadId || !reachedEnd || end >= roomRowCount) return;
    if (previous && end < previous.count) return;
    setTimeline((current) => ({ ...current, range: { start, end: roomRowCount } }));
  }, [activeTimelineRange, eventId, roomRowCount, threadId]);

  const liveTimelineLinked = timeline.linkedTimelines.includes(getLiveTimeline(room));
  const timelineAtLiveEnd = isTimelineAtLiveEnd({
    threadId,
    liveTimelineLinked,
    rangeAtEnd: activeTimelineRange.end >= roomRows.length,
    canPaginateThreadFront: threadState.canPaginateThreadFront,
    threadTailLoaded,
  });
  const atLiveEndRef = useLatestRef(timelineAtLiveEnd);
  const firstRoomTimeline = timeline.linkedTimelines[0];
  const canPaginateRoomBack =
    typeof firstRoomTimeline?.getPaginationToken(Direction.Backward) === 'string';
  const lastRoomTimeline = timeline.linkedTimelines[timeline.linkedTimelines.length - 1];
  const canPaginateRoomFront =
    typeof lastRoomTimeline?.getPaginationToken(Direction.Forward) === 'string';

  // Opening a thread: render and viewport ports for the session, and the runtime it opens with.
  const viewKeyRef = useLatestRef(viewKey);
  const openedViewKeyRef = useRef<string>();
  const renderPort = useMemo<ThreadRenderPort>(
    () => ({
      reset: (nextThreadId) => threadStateRef.current.resetThreadRenderState(nextThreadId),
      append: (targetThreadId, events) =>
        threadStateRef.current.setSupplementalThreadEvents(targetThreadId, events),
      invalidateTimeline: () => setTimeline((current) => ({ ...current })),
    }),
    [threadStateRef]
  );
  const viewportPort = useMemo<ThreadOpenViewportPort>(
    () => ({
      resetForOpen: () => {
        backController.reset();
        openedViewKeyRef.current = viewKeyRef.current;
      },
      resetAfterLeave: () => backController.reset(),
      // Queued: the next commit applies it, unless the reader scrolls first.
      requestLatestPin: () => {
        backController.requestOpenBottomPin(scrollToBottomRef);
      },
    }),
    [backController, viewKeyRef]
  );
  const priorityTargets = windowState.priorityThreadSeedPrewarmRoots;
  const { waitForExistingOrQueued } = useThreadSeedPrewarmController({
    room,
    mx,
    sessionId,
    prefetchDepthRef,
    activeThreadId: threadId,
    priorityTargets,
    debugTraceId: roomDebugTraceId,
  });
  const seedPort = useMemo(() => ({ waitForExistingOrQueued }), [waitForExistingOrQueued]);
  const beginThreadCacheWrite = useCallback(
    () => engine.persist.forRoom(room).persistThreadEventCache,
    [engine, room]
  );
  const beginRoomCacheWrite = useCallback(
    () => engine.persist.forRoom(room).persistRoomEventCache,
    [engine, room]
  );
  const threadDebugTraceIdRef = useLatestRef(threadDebugTraceId);
  const reconcile = useCallback<ThreadOpenRuntime['reconcile']>(
    (args) =>
      scheduleReconcile({
        ...args,
        mx,
        sessionId,
        scheduler: engine.scheduler,
        debugTraceId: threadDebugTraceIdRef.current,
      }),
    [engine, mx, sessionId, threadDebugTraceIdRef]
  );
  const onThreadLoadErrorRef = useLatestRef(onThreadLoadError);
  const reportThreadLoadError = useCallback(
    (failedThreadId: string) => onThreadLoadErrorRef.current?.(failedThreadId),
    [onThreadLoadErrorRef]
  );
  const runtime = useMemo<ThreadOpenRuntime>(
    () => ({
      room,
      mx,
      sessionId,
      beginCacheWrite: beginThreadCacheWrite,
      reconcile,
      seed: seedPort,
      render: renderPort,
      viewport: viewportPort,
      debugTraceId: threadDebugTraceId,
      onThreadLoadError: reportThreadLoadError,
    }),
    [
      beginThreadCacheWrite,
      mx,
      reconcile,
      renderPort,
      reportThreadLoadError,
      room,
      seedPort,
      sessionId,
      threadDebugTraceId,
      viewportPort,
    ]
  );
  useThreadOpenLifecycleController({ route, commands: session.commands, runtime });
  bindRuntime({
    mx,
    room,
    sessionId,
    beginThreadCacheWrite,
    thread: threadState.thread,
    threadEvents,
    threadHasMoreCachedBack,
    viewport: prependViewport,
  });

  // A thread opened at its latest row stays pinned there until the reader scrolls. Both flags
  // belong to the open view; the render that switches views starts them over.
  const openedAtLatestRef = useViewFlag(viewKey);
  const readerScrolledRef = useViewFlag(viewKey);
  const threadLatestOpenPending =
    !!threadId && session.snapshot.open.latestPending && openedViewKeyRef.current === viewKey;
  if (threadLatestOpenPending) openedAtLatestRef.current.value = true;
  const threadOpenedAtLatest = !!threadId && openedAtLatestRef.current.value;
  const threadUserScrolled = readerScrolledRef.current.value;

  const feature = useTimelineMessageFeature({
    room,
    editor,
    threadId,
    scrollRef,
    showThreadRepliesInRoom,
    messageLayout,
    messageSpacing,
    hideActivity,
    hideMembershipEvents,
    hideNickAvatarEvents,
    showHiddenEvents,
  });

  // Rows the thread's plans hide: repeated summaries and settled approvals.
  const getRowContent = useCallback(
    (event: MatrixEvent) =>
      getLatestMessageContent(
        event,
        getEditedEvent(event.getId() ?? '', event, threadStateRef.current.threadTimelineSet)
      ) as Record<string, unknown>,
    [threadStateRef]
  );
  const threadSummaryTimeline = useThreadSummaryTimeline(threadEvents, {
    history: {
      sdkLoaded: session.snapshot.open.sdkReady,
      canPaginateBack: threadState.canPaginateThreadBack,
      hasMoreCachedBack: threadHasMoreCachedBack,
    },
    getContent: getRowContent,
    ignoredUserIds: ignoredUsersSet,
    routeId: threadId ? eventId : undefined,
    focusId: threadId ? focusItem?.eventId : undefined,
  });
  // What each agent reply of the open thread and the thread so far cost, for Reply details.
  const threadConversationCost = useThreadConversationCostSummary(
    threadId ? threadEvents : undefined,
    {
      history: {
        sdkLoaded: session.snapshot.open.sdkReady,
        canPaginateBack: threadState.canPaginateThreadBack,
        hasMoreCachedBack: threadHasMoreCachedBack,
      },
      getContent: getRowContent,
      ignoredUserIds: ignoredUsersSet,
      viewerId: mx.getUserId() ?? undefined,
    }
  );
  const approvalTimeline = useThreadApprovalTimeline(
    threadId ? threadEvents : roomRows,
    ignoredUsersSet,
    threadId,
    eventId,
    focusItem?.eventId
  );

  // While the opening room view does not fill the screen, keep paginating.
  const roomSurfaceShown = !threadId && !compactViewRequested;
  const automaticFill = useRoomAutomaticFill({
    viewKey,
    enabled: roomSurfaceShown && !eventId,
    latestEventId: roomRows[roomRows.length - 1]?.getId(),
    contentKey: `${activeTimelineRange.start}:${activeTimelineRange.end}:${roomRows.length}`,
    getScrollElement,
    isPaginating: () => roomPaginatingBackRef.current,
  });

  // Room pagination: the window widens over loaded rows, then older history pages in.
  const handleTimelinePagination = useTimelinePagination(
    mx,
    timeline,
    setTimeline,
    ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE,
    recalibrateFilterOptsRef
  );
  const paginateRoom = useRoomPaginationCommandController({
    alive,
    handleTimelinePagination,
    mx,
    beginRoomCacheWrite,
    recalibrateFilterOptsRef,
    room,
    roomIdRef,
    roomPaginatingBackRef,
    prefetchDepthRef,
    sessionId,
    setRoomHasMoreCachedBack,
    setTimeline,
    threadId,
    threadIdRef,
    timeline,
  });
  const pendingRoomFoldPxRef = useRef(0);
  const roomFoldPriceRef = useRef<(key: string | number | bigint, index: number) => number>(
    () => 0
  );
  const handleRoomRangeChange = useCallback(
    (next: ItemRange) => {
      const current = activeRangeRef.current;
      if (!threadIdRef.current && next.start < current.start) {
        // Rows mounted above the reader: their height goes into the ledger, so the rows on
        // screen stay where they are.
        let foldPx = 0;
        for (let index = next.start; index < Math.min(current.start, next.end); index += 1) {
          const key = roomRowsRef.current[index]?.getId() ?? index;
          // Priced by its place in the window still mounted, which the estimate reads.
          foldPx += roomFoldPriceRef.current(key, index - current.start);
        }
        pendingRoomFoldPxRef.current += foldPx;
      }
      setTimeline((currentTimeline) => ({ ...currentTimeline, range: next }));
    },
    [activeRangeRef, roomRowsRef, threadIdRef]
  );
  const getRoomRowElement = useCallback(
    (index: number) =>
      scrollRef.current?.querySelector<HTMLElement>(
        `[data-room-row-index="${index - activeRangeRef.current.start}"]`
      ) ?? undefined,
    [activeRangeRef]
  );
  const handleRoomPaginationEnd = useCallback(
    (back: boolean) => {
      void paginateRoom(back);
    },
    [paginateRoom]
  );
  const shouldSuppressPagination = useCallback(() => suppressFocusPaginationRef.current, []);
  const paginator = useVirtualPaginator({
    count: roomRows.length,
    range: activeTimelineRange,
    onRangeChange: handleRoomRangeChange,
    limit: windowLimit,
    getScrollElement,
    getItemElement: getRoomRowElement,
    onEnd: handleRoomPaginationEnd,
    shouldSuppressPagination,
    deferAutomaticPagination: automaticFill.defer,
    externalBackwardScrollRestore: true,
  });

  // The virtual list and its offset ledger.
  const itemCount = threadId ? threadEvents.length : roomWindowRows.length;
  // Room indexes count from the window's first row; a fold prices rows above it (negative).
  const estimateSize = (index?: number): number => {
    if (!threadId) {
      if (compactLayout) return ROOM_ROW_ESTIMATE_PX.compact;
      const position = index === undefined ? undefined : activeTimelineRange.start + index;
      const event = position === undefined ? undefined : roomRows[position];
      if (!event || position === undefined) return ROOM_ROW_ESTIMATE_PX.comfortable;
      return estimateRoomRowHeight(event, roomRows[position - 1]);
    }
    const event = index === undefined ? undefined : threadEvents[index];
    if (!event) {
      return compactLayout
        ? THREAD_ONE_LINE_ESTIMATE_PX.compact
        : THREAD_ONE_LINE_ESTIMATE_PX.comfortable;
    }
    return estimateMessageRowHeight(event, { compact: compactLayout });
  };
  const getItemKey = (index: number): string | number => {
    const event = threadId ? threadEvents[index] : roomWindowRows[index];
    return event?.getId() ?? (threadId ? index : activeTimelineRange.start + index);
  };
  const showThreadLoadOlder = !!threadId && windowState.showThreadLoadOlderMessages;
  const threadLoadError = !!threadId && session.snapshot.open.loadError;
  const threadLoading =
    !!threadId && threadEvents.length === 0 && threadInitialRenderMode === 'loading';
  const ledger = useTimelineScrollLedgerController({
    alive,
    estimateSize,
    getItemKey,
    getScrollElement,
    itemCount,
    pendingRoomFoldPxRef,
    roomFoldPriceRef,
    roomId: room.roomId,
    threadEventIndexMap,
    threadEvents,
    threadId,
    threadInitialRenderMode,
    threadLeadingKey: [
      threadLoadError ? 'error' : '',
      showThreadLoadOlder ? 'older' : '',
      threadLoading ? 'loading' : '',
    ].join('|'),
    automaticFill: roomSurfaceShown
      ? { isActive: automaticFill.isActive, geometryReader: automaticFill.geometryReader }
      : undefined,
  });
  const { virtualizer } = ledger;
  const virtualizerRef = useLatestRef(virtualizer);
  useThreadApprovalRowMeasurements(
    virtualizer,
    threadEvents,
    threadId ? approvalTimeline.hiddenEventIds : EMPTY_IDS,
    estimateSize
  );

  // Jumps: the paginator scrolls to mounted rows and moves the window; the virtual list
  // scrolls to the rows of the window it has not mounted.
  const { scrollToItem: paginatorScrollToItem, scrollToElement, retryPagination } = paginator;
  const scrollToItem = useCallback<ScrollToItem>(
    (index, opts) => {
      if (paginatorScrollToItem(index, opts)) return true;
      const { start, end } = activeRangeRef.current;
      if (index < start || index >= end) return false;
      virtualizerRef.current.scrollToIndex(index - start, {
        align: opts?.align ?? 'center',
        behavior: opts?.behavior === 'smooth' ? 'smooth' : 'auto',
      });
      return true;
    },
    [activeRangeRef, paginatorScrollToItem, virtualizerRef]
  );
  const scrollThreadEventIntoView = useCallback(
    (targetEventId: string) => {
      const index = threadEventIndexMapRef.current.get(targetEventId);
      if (index === undefined) return false;
      virtualizerRef.current.scrollToIndex(index, { align: 'center' });
      return true;
    },
    [threadEventIndexMapRef, virtualizerRef]
  );
  const cancelThreadBottomSettle = useCallback(
    () => backController.suppressOpenBottomPin(),
    [backController]
  );
  const requestThreadOpenBottomPin = useCallback(
    () => backController.requestOpenBottomPin(scrollToBottomRef),
    [backController]
  );
  const cancelThreadOpenBottomPin = useCallback(() => {
    backController.cancelOpenBottomPin(scrollToBottomRef.current.count);
    if (readerScrolledRef.current.value) return;
    readerScrolledRef.current.value = true;
    forceRender();
  }, [backController, readerScrolledRef]);

  const effectiveThreadFilterStateRef = useLatestRef(threadIndex.effectiveThreadFilterState);
  const threadFilteredEventsRef = useLatestRef(roomRows);
  const { handleOpenEvent, openRoomEventRoute } = useRoomEventOpenController({
    alive,
    cancelThreadBottomSettle,
    effectiveViewMode,
    focusEventInRoom,
    hideMembershipEvents,
    hideNickAvatarEvents,
    ignoredUsersSet,
    mx,
    navigateRoomThread,
    overviewThreadRootIds: threadIndex.overviewThreadRootIds,
    threadTargets: session.targets,
    readUptoEventIdRef,
    recalibrateFilterOptsRef,
    room,
    roomOverviewOrderActive: threadIndex.roomOverviewOrderActive,
    roomThreadListThreads: threadIndex.roomThreadListThreads,
    prefetchDepth: windowLimit,
    prefetchDepthRef: windowLimitRef,
    scheduledStatusMap: threadIndex.scheduledStatusMap,
    scrollRef,
    scrollThreadEventIntoView,
    scrollToBottomRef,
    scrollToElement,
    scrollToItem,
    searchQuery: threadIndex.searchQuery,
    setFocusItem,
    notifyThreadEventsChanged: session.commands.notifyEventsChanged,
    setTimeline,
    showHiddenEvents,
    threadEventIndexMapRef,
    threadFilteredEvents: roomRows,
    threadFilterStateRef: effectiveThreadFilterStateRef,
    threadId,
    threadParticipantMap: threadIndex.threadParticipantMap,
    threadReplyCountMap: threadIndex.threadReplyCountMap,
    threadResolutionMap,
    threadSortControlSignature: threadIndex.threadSortControlSignature,
    threadSortFreezeState: null,
    threadSummaryInfoMap: threadIndex.threadSummaryInfoMap,
  });
  useRoomEventRouteOpenController({
    effectiveViewMode,
    eventId,
    focusEventInRoom,
    openRoomEventRoute,
    roomId: room.roomId,
    roomOverviewOrderActive: threadIndex.roomOverviewOrderActive,
    threadId,
  });

  useRoomFocusScrollController({
    cancelThreadBottomSettle,
    alive,
    atBottomAnchorRef,
    editId: feature.editingEventId,
    focusItem,
    focusScrollResetToken: room.roomId,
    threadTargets: session.targets,
    pendingThreadOpenTick: session.snapshot.targetRevision,
    retryPagination,
    roomId: room.roomId,
    scrollRef,
    scrollThreadEventIntoView,
    scrollToBottomRef,
    scrollToElement,
    scrollToItem,
    setAtBottom,
    setFocusItem,
    suppressFocusPaginationRef,
    isThreadOpenBottomPinSuppressed: backController.isOpenBottomPinSuppressed,
    requestThreadOpenBottomPin,
    cancelThreadOpenBottomPin,
    shouldApplyThreadBottomPin: backController.shouldApplyBottomPin,
    threadEventIndexMapRef,
    threadEventsLength: threadEvents.length,
    threadFilteredEvents: roomRows,
    threadFilteredEventsRef,
    threadId,
    threadInitialRenderMode,
    threadLatestOpenPending,
    threadOpenedAtLatest,
    threadUserScrolled,
    threadTimelineTick: session.snapshot.timelineRevision,
    timelineAtLiveEnd,
    unreadInfo,
    unreadScrollAnchorIndex: windowState.unreadScrollAnchorIndex,
  });

  const { handleJumpToLatest, handleJumpToUnread, handleOpenReply } =
    useRoomTimelineNavigationController({
      eventId,
      handleOpenEvent,
      hideMembershipEvents,
      hideNickAvatarEvents,
      ignoredUsersSet,
      navigateRoom,
      navigateRoomThread,
      room,
      prefetchDepth: windowLimit,
      scrollToBottomRef,
      setAtBottom,
      setTimeline,
      showHiddenEvents,
      showThreadRepliesInRoom,
      threadId,
      readUptoEventId: unreadInfo?.readUptoEventId,
    });

  const { handleMarkAsRead } = useTimelineReadReceiptController({
    atBottom,
    atBottomAnchorRef,
    atBottomRef,
    atLiveEndRef,
    getScrollElement,
    handleOpenEvent,
    hideActivity,
    mx,
    readUptoEventIdRef,
    room,
    setAtBottom,
    threadEventsLength: threadEvents.length,
    threadId,
    threadInitialRenderMode,
    threadTailLoaded,
    timelineAtLiveEnd,
    unreadInfo,
  });

  useRoomCacheHydrationController({
    alive,
    buildInitialTimeline,
    eventId,
    mx,
    room,
    roomDebugTraceId,
    roomIdRef,
    scrollToBottomRef,
    sessionId,
    setAtBottom,
    setRoomInitialCacheHydratedKey,
    setTimeline,
    threadId,
    threadIdRef,
  });
  useRoomCachedBackState({
    alive,
    eventId,
    eventsLength: renderableEvents.length,
    room,
    roomIdRef,
    sessionId,
    setRoomHasMoreCachedBack,
    setTimeline,
    threadId,
    threadIdRef,
    timeline,
  });
  const isViewportAtBottomNow = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return atBottomRef.current;
    const { scrollHeight, scrollTop, clientHeight } = element;
    return isScrollNearBottom({ scrollHeight, scrollTop, clientHeight });
  }, [atBottomRef]);
  useRoomTimelineResetRelink({
    room,
    threadId,
    eventId,
    timeline,
    rebuildTimeline: buildInitialTimeline,
    setTimeline,
    isViewportAtBottomNow,
    scrollToBottomRef,
  });
  const { refreshLatest, notifyEventsChanged, readEditResetEpoch, observeLiveTail } =
    session.commands;
  const refreshLatestThreadSlice = useCallback(
    (refreshThreadId: string) => refreshLatest(refreshThreadId, runtime),
    [refreshLatest, runtime]
  );
  const handleRoomRefresh = useCallback(
    () => setTimeline(buildInitialTimeline()),
    [buildInitialTimeline]
  );
  useThreadAwareTimelineRefresh({
    room,
    threadId,
    liveTimelineLinked,
    refreshLatestThreadSlice,
    onRoomRefresh: handleRoomRefresh,
  });
  const getLoadedThreadEvents = useCallback(() => threadEventsRef.current, [threadEventsRef]);
  useThreadGapRecovery({
    engine,
    room,
    threadId,
    append: renderPort.append,
    getLoadedEvents: getLoadedThreadEvents,
    debugTraceId: threadDebugTraceId,
  });
  const forceTimelineUpdate = useCallback(() => setTimeline((current) => ({ ...current })), []);
  useThreadEditBackfillController({
    atLiveEndRef,
    eventId,
    forceTimelineUpdate,
    mx,
    beginThreadCacheWrite,
    room,
    scrollRef,
    scrollToBottomRef,
    notifyThreadEventsChanged: notifyEventsChanged,
    editResetEpoch: session.snapshot.open.editResetEpoch,
    readEditResetEpoch,
    threadEvents,
    threadId,
    threadIdRef,
    threadTailLoaded,
  });
  useThreadSummaryPublishController({
    onStoreThreadSummary,
    room,
    thread: threadState.thread,
    threadEvents,
    threadId,
    threadSummaryInfoMap: threadIndex.threadSummaryInfoMap,
  });
  useEffect(() => {
    engine.noteRoomFocused(room.roomId, threadId);
  }, [engine, room.roomId, threadId]);
  // A reply that streams live frames grows the rows without a timeline event: follow it.
  useFollowContentGrowth(
    getScrollElement,
    contentRef,
    isViewportAtBottomNow,
    atLiveEndRef,
    getLiveReplyStore(mx),
    room.roomId
  );

  // The compact overview: older history until zero-reply roots show up, root edits it lacks,
  // and a refresh of its threads when the page comes back.
  const loadedRoomEventCount = useMemo(
    () => timeline.linkedTimelines.reduce((total, part) => total + part.getEvents().length, 0),
    [timeline]
  );
  useCompactCoverageBackfillController({
    enabled: compactViewRequested && !eventId,
    loadedEventCount: loadedRoomEventCount,
    hasZeroReplyRootCoverage: threadIndex.hasZeroReplyRootCoverage,
    canPaginateBack: canPaginateRoomBack,
    hasMoreCachedBack: roomHasMoreCachedBack,
    paginateBack: paginateRoom,
  });
  useCompactRootEditBackfillController({
    enabled: compactViewRequested,
    mx,
    overviewThreadRootIds: threadIndex.overviewThreadRootIds,
    beginRoomCacheWrite,
    room,
    roomSurfaceEventEntries: threadIndex.roomSurfaceEventEntries,
    roomThreadListThreads: threadIndex.roomThreadListThreads,
    setOverviewRefreshCounter,
  });
  useThreadOverviewResumeController({
    alive,
    activeTimelineRange,
    compactFilteredThreadRootIds: threadIndex.compactFilteredThreadRootIds,
    compactViewRequested,
    debugTraceId: roomDebugTraceId,
    filteredThreadRootIds: threadIndex.filteredThreadRootIds,
    limit: windowLimit,
    mx,
    onStoreThreadSummary: onStoreThreadSummary as (
      threadRootId: string,
      info: MindroomThreadSummaryInfo | undefined
    ) => void,
    onApplyThreadRelations: threadIndex.applyThreadOverviewRelationEvents,
    beginThreadCacheWrite,
    refreshCompactThreadList: threadIndex.refreshRoomThreadList,
    room,
    sessionId,
    setOverviewRefreshCounter,
    showCompactRoomView: threadIndex.showCompactRoomView,
    threadFilteredEventEntries: roomRowEntries,
    threadId,
    threadIdRef,
    threadReplyCountMap: threadIndex.threadReplyCountMap,
    threadResolutionMap,
  });

  // Live rows. This registers the room's last timeline listener, after every other one.
  useRoomLiveRenderController({
    atBottomRef,
    atLiveEndRef,
    effectiveThreadFilterState: threadIndex.effectiveThreadFilterState,
    hideActivity,
    hideMembershipEvents,
    hideNickAvatarEvents,
    ignoredUsersSet,
    markLiveExpansionCandidate: feature.markLiveExpansionCandidate,
    mx,
    normalThreadRecordMap: threadIndex.normalThreadRecordMap,
    onStoreThreadSummary,
    room,
    roomThreadFilterActive: threadIndex.roomThreadFilterActive,
    scrollRef,
    scrollToBottomRef,
    setSupplementalThreadEvents: renderPort.append,
    observeLiveTail,
    notifyThreadEventsChanged: notifyEventsChanged,
    setTimeline,
    setUnreadInfo,
    showHiddenEvents,
    threadEventIndexMapRef,
    threadId,
    threadResolutionMap,
    timelineAtLiveEnd,
    unreadInfo,
  });

  // Scrolling near the top of a thread's loaded rows asks for older ones. It follows the
  // reader's scrolling: a page that added nothing must not ask again by itself.
  const virtualItems = virtualizer.getVirtualItems();
  const threadPaginatingBack = threadPagination.isPending('backward');
  const autoPaginateRef = useLatestRef({
    threadId,
    paginatingBack: threadPaginatingBack,
    showLoadOlder: showThreadLoadOlder,
    hasUserScrollIntent: threadUserScrolled,
    paginateBack: threadPagination.paginateBack,
  });
  useEffect(() => {
    if (!scrollElement || !threadId) return undefined;
    const checkTop = () => {
      const current = autoPaginateRef.current;
      const shouldPaginate = shouldAutoPaginateThreadBack({
        threadId: current.threadId,
        firstRenderedIndex: virtualizerRef.current.getVirtualItems()[0]?.index,
        paginatingBack: current.paginatingBack,
        showLoadOlder: current.showLoadOlder,
        hasUserScrollIntent: current.hasUserScrollIntent,
        triggerRows: THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS,
      });
      if (shouldPaginate) void current.paginateBack();
    };
    scrollElement.addEventListener('scroll', checkTop, { passive: true });
    return () => scrollElement.removeEventListener('scroll', checkTop);
  }, [autoPaginateRef, scrollElement, threadId, virtualizerRef]);

  // The newest room row, while a request for it holds.
  const latestRowRequestRef = useLatestRowRequest({
    // A room with unread rows opens at its unread marker instead (roomFocusScrollController).
    initiallyActive: !eventId && !(unreadInfo?.scrollTo && unreadInfo.inLiveTimeline),
    scrollElement,
    scrollToBottomCount: scrollToBottomRef.current.count,
    committedView: `${viewKey}|${effectiveViewMode}`,
    focusItem,
  });
  useLayoutEffect(() => {
    if (!roomSurfaceShown || !latestRowRequestRef.current || itemCount === 0) return;
    virtualizer.scrollToIndex(itemCount - 1, { align: 'end' });
  });

  const minimap = useRoomTimelineMinimap({
    minimapEvents: threadId ? threadEvents : roomRows,
    showCompactRoomView: compactViewRequested,
    scrollRef,
    handleOpenEvent,
  });

  const { paginateBack: paginateThreadBack } = threadPagination;
  const handleLoadOlderThread = useCallback(() => {
    void paginateThreadBack();
  }, [paginateThreadBack]);
  const { expandAll, toggleExpandAll } = feature;
  const handleToggleExpandAll = useCallback(
    (evt: MouseEvent<HTMLButtonElement>) => {
      evt.preventDefault?.();
      toggleExpandAll();
    },
    [toggleExpandAll]
  );

  // Compact mode: the room's threads as cards, once the room knows which threads it has.
  if (compactViewRequested && !threadIndex.focusedRoomOverviewBypass) {
    const overviewReady =
      threadIndex.showCompactRoomView ||
      (roomInitialCacheHydratedKey === room.roomId && !clientCatchingUp);
    if (!overviewReady) {
      return (
        <Box grow="Yes" alignItems="Center" justifyContent="Center">
          <Spinner size="400" variant="Secondary" />
        </Box>
      );
    }
    const compactRootIds = threadIndex.compactOverviewOrdering.displayOrderedIds;
    return (
      <>
        <CompactThreadCount count={compactRootIds.length} />
        <CompactRoomView
          room={room}
          threadRootIds={compactRootIds}
          threadRecordMap={threadIndex.compactThreadRecordMap}
          onThreadClick={(rootId) => navigateRoomThread(room.roomId, rootId)}
          compactRoomScrollStateRef={compactRoomScrollStateRef}
        />
      </>
    );
  }

  const messageData: TimelineMessageData = {
    threadRecordMap: threadIndex.threadRecordMap,
    threadEventMap: threadState.threadEventMap ?? new Map(),
    approvalTimeline,
    threadSummaryTimeline,
    handleOpenReply,
  };
  const rowTimelineSet =
    (threadId && threadState.threadTimelineSet) || room.getUnfilteredTimelineSet();
  const getRowEvent = (index: number): MatrixEvent | undefined =>
    threadId ? threadEvents[index] : roomWindowRows[index];
  const isRowHidden = (event: MatrixEvent): boolean => {
    const id = event.getId() ?? '';
    if (approvalTimeline.hiddenEventIds.has(id) || threadSummaryTimeline.hiddenEventIds.has(id)) {
      return true;
    }
    const sender = event.getSender();
    if (sender && ignoredUsersSet.has(sender)) return true;
    return event.isRedacted() && !showHiddenEvents;
  };
  const rowContexts = foldTimelineRowContexts({
    indexes: virtualItems.map((item) => item.index),
    getEvent: getRowEvent,
    isSkipped: isRowHidden,
    getAbsoluteIndex: threadId
      ? undefined
      : (index) => roomRowEntries[activeTimelineRange.start + index]?.absoluteIndex,
    readUptoAbsoluteIndex: threadId ? undefined : windowState.readUptoAbsoluteIndex,
  });

  const renderTile = (item: VirtualItem): ReactNode => {
    const event = getRowEvent(item.index);
    if (!event) return null;
    // An edit or a reaction has no row of its own. A height measured before it decrypted keeps
    // its tile mounted until measuring corrects it.
    if (item.size === 0 && reactionOrEditEvent(event)) return null;
    const id = event.getId() ?? '';
    const context = rowContexts.get(item.index);
    let content: ReactNode = null;
    if (context && !isRowlessTimelineEvent(event)) {
      const row: TimelineMessageRow = {
        eventId: id,
        event,
        index: item.index,
        timelineSet: rowTimelineSet,
        collapse: context.collapse,
        highlighted: focusItem?.eventId === id && focusItem.highlight,
        previousEventId: context.previousEventId,
      };
      const rendered = feature.renderEvent(row, messageData);
      if (rendered !== null) {
        content = (
          <>
            {context.unreadDivider && (
              <DividerLabel
                unread
                label={t('mindroomUi.threads.mindroomRoomTimeline.newMessages')}
              />
            )}
            {context.dayDivider && <DayDivider ts={event.getTs()} />}
            {rendered}
          </>
        );
      }
    }
    return (
      <VirtualTile
        key={item.key as React.Key}
        ref={ledger.measureElement}
        virtualItem={item}
        style={{ top: item.start + ledger.ledgerPxAtRender }}
      >
        <div data-room-row-index={threadId ? undefined : item.index}>{content}</div>
      </VirtualTile>
    );
  };

  const showRoomIntro =
    !threadId &&
    liveTimelineLinked &&
    activeTimelineRange.start === 0 &&
    !canPaginateRoomBack &&
    !roomHasMoreCachedBack;
  const showRoomBackSentinel =
    !threadId && (activeTimelineRange.start > 0 || canPaginateRoomBack || roomHasMoreCachedBack);
  const showRoomFrontSentinel =
    !threadId && (activeTimelineRange.end < roomRows.length || canPaginateRoomFront);
  const showJumpToUnread =
    !threadId && !!unreadInfo?.readUptoEventId && (!unreadInfo.inLiveTimeline || roomUnread);
  const expandAllButton = (
    <button type="button" style={expandAllToggleStyle} onClick={handleToggleExpandAll}>
      {expandAll
        ? t('mindroomUi.threads.message-rendering.useTimelineMessageExpansion.all')
        : t('mindroomUi.threads.message-rendering.useTimelineMessageExpansion.all2')}
    </button>
  );
  // Under a thread's banner the toggle hangs in the gap above the first row; in the room it
  // takes a line of its own above the rows.
  const expandAllToggle = itemCount > 0 && (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        padding: `${config.space.S100} ${config.space.S700} 0`,
      }}
    >
      {expandAllButton}
    </div>
  );
  const bannerExpandAllToggle = itemCount > 0 && (
    <div style={{ position: 'absolute', top: config.space.S300, right: config.space.S500 }}>
      {expandAllButton}
    </div>
  );

  return (
    <Box grow="Yes" direction="Column" style={{ minHeight: 0, position: 'relative' }}>
      {showJumpToUnread && (
        <div
          className={css.TimelineFloat({ position: 'Top' })}
          style={{ top: `calc(${overlay.controlsTopInset} + ${config.space.S300})` }}
        >
          <FloatingAction
            primary
            icon={Icons.MessageUnread}
            label={t('mindroomUi.threads.mindroomRoomTimeline.jumpToUnread')}
            onSelect={handleJumpToUnread}
          />
          <FloatingAction
            icon={Icons.CheckTwice}
            label={t('mindroomUi.threads.mindroomRoomTimeline.markAsRead')}
            onSelect={handleMarkAsRead}
          />
        </div>
      )}
      <Scroll ref={attachScroll} className={overlay.Scroll} visibility="Hover" size="300">
        <Box
          ref={contentRef}
          direction="Column"
          justifyContent={threadId ? 'Start' : 'End'}
          style={{
            minHeight: '100%',
            paddingTop: overlay.topInset,
            paddingBottom: `calc(${overlay.footerInset} + ${config.space.S400})`,
          }}
        >
          {threadId ? (
            <>
              {threadHeader && (
                <ThreadTimelineHeader
                  expansionControl={bannerExpandAllToggle}
                  onResize={ledger.holdThreadBannerResize}
                  scrollRef={scrollRef}
                >
                  {threadHeader}
                </ThreadTimelineHeader>
              )}
              <div ref={ledger.threadLeadingRef}>
                {threadLoadError && (
                  <Box justifyContent="Center" style={{ padding: config.space.S400 }}>
                    <Text size="T300" priority="300">
                      {t('mindroomUi.threads.mindroomRoomTimeline.failedToLoadThisThread')}
                    </Text>
                  </Box>
                )}
                {showThreadLoadOlder && (
                  <Box justifyContent="Center" style={{ padding: config.space.S200 }}>
                    <Chip
                      variant="SurfaceVariant"
                      radii="Pill"
                      outlined
                      before={
                        threadPaginatingBack ? (
                          <Spinner size="50" variant="Secondary" />
                        ) : (
                          <Icon size="50" src={Icons.ArrowTop} />
                        )
                      }
                      onClick={handleLoadOlderThread}
                    >
                      <Text size="L400">
                        {threadPaginatingBack
                          ? t('mindroomUi.threads.mindroomRoomTimeline.loading')
                          : t('mindroomUi.threads.mindroomRoomTimeline.loadOlderMessages')}
                      </Text>
                    </Chip>
                  </Box>
                )}
                {threadLoading && (
                  <Box justifyContent="Center" style={{ padding: config.space.S400 }}>
                    <Spinner size="300" variant="Secondary" />
                  </Box>
                )}
                {!threadHeader && expandAllToggle}
              </div>
            </>
          ) : (
            <>
              {showRoomIntro && <RoomIntro room={room} />}
              {showRoomBackSentinel && (
                <div ref={paginator.observeBackAnchor} style={{ height: 1 }} />
              )}
              {expandAllToggle}
            </>
          )}
          <ThreadConversationCostProvider value={threadConversationCost}>
            {feature.wrapExpansion(
              <div
                ref={ledger.virtualInnerRef}
                data-thread-count={threadId ? threadEvents.length : undefined}
                data-testid={threadId ? undefined : 'room-virtual-inner'}
                style={{
                  position: 'relative',
                  height: virtualizer.getTotalSize(),
                  visibility: automaticFill.hideInitialRows ? 'hidden' : undefined,
                }}
              >
                {virtualItems.map(renderTile)}
              </div>
            )}
          </ThreadConversationCostProvider>
          {showRoomFrontSentinel && (
            <div ref={paginator.observeFrontAnchor} style={{ height: 1 }} />
          )}
          <span ref={atBottomAnchorRef} />
        </Box>
        {/* In the scroll area for its accessibility tree; the unpositioned Scroll leaves it
            placed by the timeline box, so it stays between the header and the composer. */}
        <InsetScrollbar
          scrollRef={scrollRef}
          contentRef={contentRef}
          className={overlay.Scrollbar}
          label={t('threadNav.messages')}
        />
      </Scroll>
      {minimap.minimapItems.length > 0 && (
        <TimelineMinimap
          items={minimap.minimapItems}
          stripMap={minimap.minimapStripMap}
          onSelect={minimap.handleMinimapSelect}
        />
      )}
      {!atBottom && (
        <div
          className={css.TimelineFloat({ position: 'Bottom' })}
          style={{ bottom: `calc(${overlay.footerInset} + ${config.space.S400})` }}
        >
          <FloatingAction
            icon={Icons.ArrowBottom}
            label={t('mindroomUi.threads.mindroomRoomTimeline.jumpToLatest')}
            onSelect={handleJumpToLatest}
          />
        </div>
      )}
    </Box>
  );
}
