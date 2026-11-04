import React, {
  type Dispatch,
  type SetStateAction,
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
import {
  Direction,
  EventType,
  ThreadEvent,
  type EventTimeline,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import type { VirtualItem } from '@tanstack/react-virtual';
import type { Editor } from 'slate';
import { Box, Scroll, Spinner, Text, color, config } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useAlive } from '../../hooks/useAlive';
import { useIgnoredUsers } from '../../hooks/useIgnoredUsers';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useInitialClientCatchup } from '../../hooks/useInitialClientCatchup';
import { useVirtualPaginator, type ItemRange } from '../../hooks/useVirtualPaginator';
import { useSettingValue } from '../../state/hooks/useSettingValue';
import { useRoomUnread } from '../../state/hooks/unread';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { MessageLayout, settingsAtom } from '../../state/settings';
import { getEditedEvent, getLatestMessageContent, reactionOrEditEvent } from '../../utils/room';
import { today, timeDayMonthYear, yesterday } from '../../utils/time';
import { RoomIntro } from '../../components/room-intro';
import { VirtualTile } from '../../components/virtualizer';
import { InsetScrollbar } from '../../components/inset-scrollbar/InsetScrollbar';
import { mindroomSettingsAtom } from '../settings/mindroomSettings';
import { sanitizePrefetchDepth } from '../engine/prefetchPolicy';
import { scheduleReconcile, useMindroomSyncEngine } from '../engine';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import type { ScrollAnchorMemory } from '../scroll/scrollAnchorMemory';
import { CompactRoomView } from './CompactRoomView';
import { CompactRoomWithoutThreads } from './CompactRoomWithoutThreads';
import * as overlay from './RoomOverlay.css';
import { ThreadTimelineHeader } from './ThreadTimelineHeader';
import { TimelineMinimap } from './TimelineMinimap';
import { useTimelineMessageFeature } from './message-rendering/useTimelineMessageFeature';
import type { TimelineMessageData, TimelineMessageRow } from './message-rendering/types';
import { getRenderableEventEntries, type TimelineEventEntry } from './roomTimelineEvents';
import { buildClassicRoomRowEntries } from './roomTimelineClassicRows';
import type { RoomViewMode } from './roomViewMode';
import type {
  FilterPreset,
  ThreadFilterKey,
  ThreadFilterState,
  ThreadSortFreezeState,
} from './roomThreadOverviewModel';
import { RoomThreadOverview } from './RoomThreadOverview';
import { useThreadSortFreezeController } from './threadSortFreezeController';
import {
  DIRECT_ROOM_TIMELINE_FILTER_STATE,
  resolveRoomTimelineViewState,
} from './roomTimelineViewState';
import {
  getInitialTimeline,
  getLiveTimeline,
  getRangeWithoutRow,
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
import { useLiveEventRemove } from './roomLiveEventArrive';
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
import { countCacheProbe } from './cacheProbe';
import { estimateMessageRowHeight, estimateRoomRowHeight } from './timelineRowEstimate';
import { isTimelineAtLiveEnd } from './timelineScrollUtils';
import { useFooterBottomPin } from './useFooterBottomPin';
import { foldTimelineRowContexts, isRowlessTimelineEvent } from './timelineRowFold';
import {
  ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE,
  THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS,
} from './preloadSettings';
import type { ThreadSummaryWriter } from './threadSummaryState';
import { useLatestRef, useViewScopedFlag } from './roomTimelineViewScope';
import {
  useLatestRowPin,
  useTimelineRowJumps,
  useTimelineScrollElement,
  useViewportAtBottomNow,
} from './roomTimelineScroll';
import {
  offersJumpToUnread,
  UnreadActions,
  useMarkRoomAsRead,
  useRoomUnreadInfo,
  useShownInScrollArea,
} from './roomTimelineUnread';
import {
  BannerExpandAllToggle,
  ExpandAllLine,
  FilterBarSlot,
  JumpToLatestAction,
  ThreadLoadingLines,
  footerProbeStyle,
  roomViewStyleUnder,
  threadViewStyle,
} from './RoomTimelineOverlays';

export type RoomTimelineProps = {
  room: Room;
  eventId?: string;
  threadId?: string;
  /** Show a permalinked thread root in the room instead of opening its thread. */
  focusEventInRoom?: boolean;
  summaryMap: ReadonlyMap<string, MindroomThreadSummaryInfo>;
  onStoreThreadSummary: ThreadSummaryWriter;
  threadFilterState: ThreadFilterState;
  /** The filter bar's sort lock: the room's thread order as it was when the reader locked it. */
  threadSortFreezeState?: ThreadSortFreezeState | null;
  setThreadSortFreezeState?: Dispatch<SetStateAction<ThreadSortFreezeState | null>>;
  /** Without agents the filter bar keeps only its search and sort. */
  hasMindroomAgents?: boolean;
  /** The filter bar's controls; the room view keeps the state they change. */
  onToggle?: (key: ThreadFilterKey) => void;
  onSortDirectionChange?: () => void;
  onToggleThreadSortFreeze?: () => void;
  onReset?: () => void;
  onCycleTag?: (tag: string) => void;
  onAddTag?: (tag: string) => void;
  onRemoveTag?: (tag: string) => void;
  onApplyPreset?: (preset: FilterPreset) => void;
  onSearchQueryChange?: (query: string) => void;
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
/** Stand-ins for filter bar handlers a caller leaves out. */
const ignoreFilterChange = () => undefined;
const ignoreSortFreezeUpdate: Dispatch<SetStateAction<ThreadSortFreezeState | null>> = () =>
  undefined;

/**
 * Rows are priced by their content until measured (timelineRowEstimate). The Compact layout
 * prices room rows at one height, and a row the window does not know takes the comfortable one.
 */
const ROOM_ROW_ESTIMATE_PX = { compact: 96, comfortable: 68 } as const;
/**
 * Added to content-based room estimates, which are whole pixels and often exact. virtual-core
 * records a measured size only when it differs from the estimate, and the automatic fill reveals
 * the rows only once every mounted row is recorded; a row of zero estimated height would not
 * even mount to be measured.
 */
const ROOM_ROW_UNMEASURED_PX = 0.5;
const THREAD_ONE_LINE_ESTIMATE_PX = { compact: 26, comfortable: 30 } as const;

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

/**
 * Calls `onDeleted` when one of the room's threads goes away while the room (not a thread) is
 * shown. The SDK edits the room's timeline in place for it, without a timeline event: it takes
 * the thread off the root and its replies, and a root may leave the timeline with it.
 */
const useRoomThreadDeleted = (room: Room, threadId: string | undefined, onDeleted: () => void) => {
  useEffect(() => {
    if (threadId) return undefined;
    room.on(ThreadEvent.Delete, onDeleted);
    return () => {
      room.removeListener(ThreadEvent.Delete, onDeleted);
    };
  }, [room, threadId, onDeleted]);
};

/**
 * Takes a row that left the room's timeline (a cancelled send, say) out of the window, which
 * keeps every other row it held: the rows after it move up a place, and a window that reached the
 * newest row still ends there. Thread views keep their own rows.
 *
 * A back page in flight counted the rows before it started and sets its window when it lands,
 * which leaves the removed row out. The removal waits for it, so the window is not drawn again
 * over the page's new rows with the range from before the page.
 */
const useRoomRowRemoval = ({
  room,
  timelineRef,
  roomRowsRef,
  activeRangeRef,
  windowFollowsRowsRef,
  paginatingBackRef,
  threadIdRef,
  setTimeline,
}: {
  room: Room;
  timelineRef: MutableRefObject<Timeline>;
  roomRowsRef: MutableRefObject<MatrixEvent[]>;
  activeRangeRef: MutableRefObject<Timeline['range']>;
  /** False while the filtered overview mounts every row, whatever the window. */
  windowFollowsRowsRef: MutableRefObject<boolean>;
  paginatingBackRef: MutableRefObject<boolean>;
  threadIdRef: MutableRefObject<string | undefined>;
  setTimeline: Dispatch<SetStateAction<Timeline>>;
}) => {
  const handleRemove = useCallback(
    (mEvent: MatrixEvent, removedFrom: EventTimeline | undefined) => {
      if (threadIdRef.current || paginatingBackRef.current) return;
      const shown = timelineRef.current;
      // The room's thread lists drop and add again roots that stay in the room; only the
      // timelines the window shows take its rows away.
      if (!removedFrom || !shown.linkedTimelines.includes(removedFrom)) return;
      const eventId = mEvent.getId();
      const rowIndex = roomRowsRef.current.findIndex(
        (row) => row === mEvent || (eventId !== undefined && row.getId() === eventId)
      );
      const range =
        rowIndex === -1 || !windowFollowsRowsRef.current
          ? undefined
          : getRangeWithoutRow(activeRangeRef.current, rowIndex);
      // A window set since the last render is newer than the rows the index came from.
      setTimeline((current) =>
        range && current.range === shown.range ? { ...current, range } : { ...current }
      );
    },
    [
      activeRangeRef,
      paginatingBackRef,
      roomRowsRef,
      setTimeline,
      threadIdRef,
      timelineRef,
      windowFollowsRowsRef,
    ]
  );
  useLiveEventRemove(room, handleRemove);
};

const dividerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  alignItems: 'center',
  columnGap: config.space.S200,
  padding: `${config.space.S200} ${config.space.S400}`,
};

/** A date or unread separator: a label between two hairlines. */
function DividerLabel({
  label,
  unread = false,
  separatorRef,
}: {
  label: string;
  unread?: boolean;
  separatorRef?: React.Ref<HTMLDivElement>;
}) {
  const lineColor = unread ? color.Success.ContainerLine : color.SurfaceVariant.ContainerLine;
  const rule = <span style={{ height: 1, background: lineColor }} />;
  const labelColor = unread ? color.Success.Main : color.SurfaceVariant.OnContainer;
  return (
    <div ref={separatorRef} role="separator" style={{ ...dividerStyle, color: labelColor }}>
      {rule}
      <Text size="L400">{label}</Text>
      {rule}
    </div>
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
    threadSortFreezeState = null,
    setThreadSortFreezeState,
    hasMindroomAgents = true,
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

  // Without agents, the threaded view is the room's conversation in the order it was sent, like
  // the Full view: no filter bar, so no filter or sort of the bar applies there. The Compact
  // cards keep the bar (search and sort) in every room.
  const plainConversation = viewMode === 'threaded' && !hasMindroomAgents;
  const {
    effectiveViewMode,
    focusedRoomOverviewRequested,
    requestedThreadFilterState,
    showRoomThreadOverviewControls,
  } = resolveRoomTimelineViewState({
    eventId,
    focusEventInRoom,
    threadFilterState: plainConversation ? DIRECT_ROOM_TIMELINE_FILTER_STATE : threadFilterState,
    threadId,
    viewMode,
  });
  const [filterBarHeight, setFilterBarHeight] = useState<number | null>(null);
  const showThreadRepliesInRoom = effectiveViewMode === 'classic';
  const viewKey = `${room.roomId}|${threadId ?? ''}`;

  // References the controllers share.
  const { scrollRef, scrollElement, attachScroll, getScrollElement } = useTimelineScrollElement();
  // As tall as the footer inset: a growing composer moves the newest row up with it.
  const footerProbeRef = useRef<HTMLDivElement>(null);
  useFooterBottomPin(scrollElement, footerProbeRef);
  // Jump to Unread gives way while the "New messages" line it jumps to is in view.
  const [unreadMarker, setUnreadMarker] = useState<HTMLDivElement | null>(null);
  const unreadMarkerShown = useShownInScrollArea(unreadMarker, scrollElement);
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
  const [unreadInfo, setUnreadInfo] = useRoomUnreadInfo(room, !!threadId || !!eventId);
  const readUptoEventIdRef = useLatestRef(unreadInfo?.readUptoEventId);

  const { overviewRefreshCounter, setOverviewRefreshCounter } = useThreadOverviewRefreshCounter(
    room,
    threadId
  );
  // The room's rows come from its timeline once more, so a deleted thread's root leaves the
  // overview, a frozen sort order included.
  const rederiveRoomRows = useCallback(() => setTimeline((current) => ({ ...current })), []);
  useRoomThreadDeleted(room, threadId, rederiveRoomRows);

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
    threadSortFreezeState,
    overviewRefreshCounter,
    sessionId,
    mx,
    onStoreThreadSummary: onStoreThreadSummary as (
      threadRootId: string,
      info: MindroomThreadSummaryInfo | undefined
    ) => void,
  });

  const threadRecordMapRef = useLatestRef(threadIndex.threadRecordMap);
  useThreadSortFreezeController({
    activeLiveOverviewThreadRootIds: threadIndex.activeLiveOverviewThreadRootIds,
    setThreadSortFreezeState: setThreadSortFreezeState ?? ignoreSortFreezeUpdate,
    threadId,
    threadSortControlSignature: threadIndex.threadSortControlSignature,
    threadSortFreezeState,
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
  const timelineRef = useLatestRef(timeline);
  const windowFollowsRowsRef = useLatestRef(!threadIndex.roomThreadFilterActive);
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
  const firstRoomTimelineRef = useLatestRef(firstRoomTimeline);
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
  const openedAtLatestRef = useViewScopedFlag(viewKey);
  const readerScrolledRef = useViewScopedFlag(viewKey);
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
    [activeRangeRef, scrollRef]
  );
  // A page that moves the room's back token but adds no rows (the server only moved its token,
  // or reached the room's start) leaves the window as it was: nothing else would show the room's
  // start or drop the sentinel, and the paginator, which follows window changes, would not ask
  // again while it stays in view. Each such page renders again and checks the sentinel once more.
  const [roomBackPage, setRoomBackPage] = useState<{ rowsBefore: number }>();
  const handleRoomPaginationEnd = useCallback(
    (back: boolean) => {
      const edge = back ? firstRoomTimelineRef.current : undefined;
      const tokenBefore = edge?.getPaginationToken(Direction.Backward);
      const rowsBefore = roomRowsRef.current.length;
      void paginateRoom(back).then(() => {
        if (!edge || !alive() || edge.getPaginationToken(Direction.Backward) === tokenBefore)
          return;
        setRoomBackPage({ rowsBefore });
      });
    },
    [alive, firstRoomTimelineRef, paginateRoom, roomRowsRef]
  );
  const shouldSuppressPagination = useCallback(() => suppressFocusPaginationRef.current, []);
  // The opening fill loads a screen of history above the reader. A short room, whose creation
  // event came with the sync, has nothing older to load ahead: its start (the room intro) shows
  // once the reader scrolls up to it.
  const automaticBackReach = useCallback(() => {
    const first = firstRoomTimelineRef.current?.getEvents()[0];
    if (first?.getType() === EventType.RoomCreate) return 0;
    return scrollRef.current?.clientHeight ?? 0;
  }, [firstRoomTimelineRef, scrollRef]);
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
    automaticBackReach,
    externalBackwardScrollRestore: true,
  });

  // The virtual list and its offset ledger.
  const itemCount = threadId ? threadEvents.length : roomWindowRows.length;
  // Room indexes count from the window's first row; a fold prices rows above it (negative).
  // They read the newest rows and window through refs: the paginator folds a widened window
  // in its layout effect, before the ledger hands over this render's pricing, and a fold
  // priced apart from the rows the virtual list then lays out moves the reader.
  const estimateSize = (index?: number): number => {
    if (!threadId) {
      if (compactLayout) return ROOM_ROW_ESTIMATE_PX.compact;
      const rows = roomRowsRef.current;
      const position = index === undefined ? undefined : activeRangeRef.current.start + index;
      const event = position === undefined ? undefined : rows[position];
      if (!event || position === undefined) {
        return ROOM_ROW_ESTIMATE_PX.comfortable + ROOM_ROW_UNMEASURED_PX;
      }
      // The threaded view shows a badge under each message that has a thread record.
      const threadBadge =
        !showThreadRepliesInRoom && threadRecordMapRef.current.has(event.getId() ?? '');
      return (
        estimateRoomRowHeight(event, rows[position - 1], { threadBadge }) + ROOM_ROW_UNMEASURED_PX
      );
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
  useLayoutEffect(() => {
    // A page that added rows moved the window, and the paginator carries on from there.
    if (roomBackPage && roomRowsRef.current.length === roomBackPage.rowsBefore) retryPagination();
  }, [retryPagination, roomBackPage, roomRowsRef]);
  const { scrollToItem, scrollThreadEventIntoView } = useTimelineRowJumps({
    paginatorScrollToItem,
    activeRangeRef,
    virtualizerRef,
    threadEventIndexMapRef,
  });
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
    threadSortFreezeState,
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

  const markRoomAsRead = useMarkRoomAsRead(handleMarkAsRead, setUnreadInfo, threadId);

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
  const isViewportAtBottomNow = useViewportAtBottomNow(scrollRef, atBottomRef);
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

  useRoomRowRemoval({
    room,
    timelineRef,
    roomRowsRef,
    activeRangeRef,
    windowFollowsRowsRef,
    paginatingBackRef: roomPaginatingBackRef,
    threadIdRef,
    setTimeline,
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
      if (!shouldPaginate) return;
      // The probe tells this trigger apart from the open's own history pages.
      countCacheProbe('threadAutoPaginateBackFired');
      void current.paginateBack();
    };
    scrollElement.addEventListener('scroll', checkTop, { passive: true });
    return () => scrollElement.removeEventListener('scroll', checkTop);
  }, [autoPaginateRef, scrollElement, threadId, virtualizerRef]);

  // The newest room row, while a request for it holds.
  useLatestRowPin({
    shown: roomSurfaceShown,
    itemCount,
    virtualizer,
    // A room with unread rows opens at its unread marker instead (roomFocusScrollController).
    opensAtLatest: !eventId && !(unreadInfo?.scrollTo && unreadInfo.inLiveTimeline),
    roomId: room.roomId,
    scrollElement,
    scrollToBottomCount: scrollToBottomRef.current.count,
    committedView: `${viewKey}|${effectiveViewMode}`,
    focusItem,
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

  const compactCards = compactViewRequested && !threadIndex.focusedRoomOverviewBypass;
  const filterBar = showRoomThreadOverviewControls && !plainConversation && (
    <FilterBarSlot onHeight={setFilterBarHeight}>
      <RoomThreadOverview
        hasMindroomAgents={hasMindroomAgents}
        threadCount={
          (compactCards ? threadIndex.compactOverviewOrdering : threadIndex.normalOverviewOrdering)
            .displayOrderedIds.length
        }
        totalThreadCount={
          (compactCards ? threadIndex.compactThreadRootData : threadIndex.visibleThreadRootData).ids
            .length
        }
        statusCounts={threadIndex.statusCounts}
        tagCounts={threadIndex.tagCounts}
        state={threadFilterState}
        availableTags={threadIndex.availableRoomTags}
        isThreadSortFrozen={!!threadSortFreezeState}
        onToggle={props.onToggle ?? ignoreFilterChange}
        onSortDirectionChange={props.onSortDirectionChange ?? ignoreFilterChange}
        onToggleThreadSortFreeze={props.onToggleThreadSortFreeze ?? ignoreFilterChange}
        onReset={props.onReset ?? ignoreFilterChange}
        onCycleTag={props.onCycleTag ?? ignoreFilterChange}
        onAddTag={props.onAddTag ?? ignoreFilterChange}
        onRemoveTag={props.onRemoveTag ?? ignoreFilterChange}
        onApplyPreset={props.onApplyPreset ?? ignoreFilterChange}
        onSearchQueryChange={props.onSearchQueryChange ?? ignoreFilterChange}
      />
    </FilterBarSlot>
  );
  const roomStyle = roomViewStyleUnder(filterBar ? filterBarHeight : null);

  // Compact mode: the room's threads as cards. A room without any thread waits until it knows
  // it has none (its cache read and the client's first catch-up), then shows its timeline under
  // the bar instead, which pages back to the room's start and there says it has no thread (not
  // the intro: the header already names the room). A filter that hides every thread keeps the
  // cards and their empty state.
  const noThreadYet =
    compactCards &&
    !threadIndex.showCompactRoomView &&
    (roomInitialCacheHydratedKey !== room.roomId || clientCatchingUp);
  if (noThreadYet) {
    return (
      <Box grow="Yes" alignItems="Center" justifyContent="Center">
        <Spinner size="400" variant="Secondary" />
      </Box>
    );
  }
  if (compactCards && threadIndex.showCompactRoomView) {
    const compactRootIds = threadIndex.compactOverviewOrdering.displayOrderedIds;
    return (
      <Box grow="Yes" direction="Column" style={roomStyle}>
        {filterBar}
        <CompactRoomView
          room={room}
          threadRootIds={compactRootIds}
          threadRecordMap={threadIndex.compactThreadRecordMap}
          onThreadClick={(rootId) => navigateRoomThread(room.roomId, rootId)}
          compactRoomScrollStateRef={compactRoomScrollStateRef}
        />
      </Box>
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
                separatorRef={setUnreadMarker}
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
  const showJumpToUnread = offersJumpToUnread({
    threadId,
    unreadInfo,
    roomUnread,
    unreadMarkerShown,
  });
  // Under a thread's banner the toggle hangs in the gap above the first row; in the room it
  // takes a line of its own above the rows.
  const expandAllToggle = itemCount > 0 && (
    <ExpandAllLine expanded={expandAll} onToggle={handleToggleExpandAll} />
  );
  const bannerExpandAllToggle = itemCount > 0 && (
    <BannerExpandAllToggle expanded={expandAll} onToggle={handleToggleExpandAll} />
  );

  return (
    <Box grow="Yes" direction="Column" style={threadId ? threadViewStyle : roomStyle}>
      <div ref={footerProbeRef} aria-hidden style={footerProbeStyle} />
      {filterBar}
      {showJumpToUnread && (
        <UnreadActions onJumpToUnread={handleJumpToUnread} onMarkAsRead={markRoomAsRead} />
      )}
      <Scroll ref={attachScroll} className={overlay.Scroll} visibility="Hover" size="300">
        <Box
          ref={contentRef}
          direction="Column"
          justifyContent={threadId || compactCards ? 'Start' : 'End'}
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
                <ThreadLoadingLines
                  loadError={threadLoadError}
                  showLoadOlder={showThreadLoadOlder}
                  paginatingBack={threadPaginatingBack}
                  loading={threadLoading}
                  onLoadOlder={handleLoadOlderThread}
                />
                {!threadHeader && expandAllToggle}
              </div>
            </>
          ) : (
            <>
              {showRoomIntro &&
                (compactCards ? <CompactRoomWithoutThreads /> : <RoomIntro room={room} />)}
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
        </Box>
        {/* After the content's padding, so "at the bottom" means the end of the scroll range,
            not the last row, which sits a composer's height higher, behind the footer. */}
        <span ref={atBottomAnchorRef} style={{ display: 'block', height: 0 }} />
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
      {!atBottom && <JumpToLatestAction onSelect={handleJumpToLatest} />}
    </Box>
  );
}
