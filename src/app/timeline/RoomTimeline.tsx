import {
  type Dispatch,
  type SetStateAction,
  useCallback,
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
import type { Editor } from 'slate';
import { Box, Scroll, Spinner, config } from 'folds';
import type { VirtualItem } from '@tanstack/react-virtual';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useAlive } from '../lib/hooks/useAlive';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { useIgnoredUsers } from '../matrix/hooks/useIgnoredUsers';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { useInitialClientCatchup } from '../matrix/hooks/useInitialClientCatchup';
import { useSettingValue } from '../preferences/useSettingValue';
import { useRoomUnread } from '../matrix/state/useUnread';
import { roomToUnreadAtom } from '../matrix/state/roomToUnread';
import { MessageLayout, settingsAtom } from '../preferences/settings';
import { getEditedEvent, getLatestMessageContent } from '../matrix/room';
import { RoomIntro } from './RoomIntro';
import { InsetScrollbar } from '../ui/InsetScrollbar';
import { prefetchSettingsAtom } from '../event-store/engine/prefetchSettings';
import { sanitizePrefetchDepth } from '../event-store/engine/prefetchPolicy';
import { scheduleReconcile, useSyncEngine } from '../event-store/engine';
import type { ThreadSummaryInfo } from '../matrix/protocol/threadSummary';
import type { ScrollAnchorMemory } from '../ui/scrollAnchorMemory';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { CompactRoomView } from '../threads/overview/CompactRoomView';
import { CompactRoomWithoutThreads } from './CompactRoomWithoutThreads';
import * as overlay from '../ui/styles/RoomOverlay.css';
import { ThreadTimelineHeader } from '../threads/ThreadTimelineHeader';
import { TimelineMinimap } from './TimelineMinimap';
import { useTimelineMessageFeature } from './message-rendering/useTimelineMessageFeature';
import type { TimelineMessageData } from './message-rendering/types';
import type { RoomViewMode } from '../navigation/roomViewMode';
import type {
  FilterPreset,
  ThreadFilterKey,
  ThreadFilterState,
  ThreadSortFreezeState,
} from '../event-store/threads/roomThreadOverviewModel';
import { RoomThreadOverview } from '../threads/overview/RoomThreadOverview';
import { ThreadPeopleFilter } from '../threads/overview/ThreadPeopleFilter';
import { useThreadSortFreezeController } from '../threads/overview/threadSortFreezeController';
import {
  DIRECT_ROOM_TIMELINE_FILTER_STATE,
  resolveRoomTimelineViewState,
} from '../event-store/timeline/roomTimelineViewState';
import {
  getInitialTimeline,
  getLiveTimeline,
  type RecalibrateFilterOpts,
  type Timeline,
} from '../event-store/timeline/timelinePagination';
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
import { useCompactCoverageBackfillController } from '../threads/overview/compactCoverageBackfillController';
import { useCompactHistoryAtEnd } from '../threads/overview/useCompactHistoryAtEnd';
import { useCompactRootEditBackfillController } from '../threads/overview/compactRootEditBackfillController';
import { useThreadOverviewResumeController } from '../threads/overview/threadOverviewResumeController';
import { getLiveReplyStore } from '../messages/live/liveReplyStore';
import { useThreadOverviewRefreshCounter } from '../threads/overview/threadOverviewRefreshCounter';
import { useTimelineDebugTraceIds } from './timelineDebugController';
import { useThreadIndex } from '../threads/overview/useThreadIndex';
import { useRoomThreadResolutionMap } from '../threads/tags/useRoomThreadTags';
import { useThreadTimelineState } from './useThreadTimelineState';
import { useThreadSession } from '../threads/open/useThreadSession';
import { useThreadPagination } from '../threads/open/useThreadPagination';
import type {
  ThreadOpenRuntime,
  ThreadOpenViewportPort,
  ThreadRenderPort,
  ThreadRoute,
} from '../threads/open/threadSessionTypes';
import { useThreadBackPaginationController } from './threadBackPaginationController';
import { useThreadPrependViewport } from './useThreadPrependViewport';
import { useThreadOpenLifecycleController } from '../threads/open/threadOpenLifecycleController';
import { useThreadSeedPrewarmController } from '../threads/open/threadSeedPrewarmController';
import { useThreadGapRecovery } from '../threads/open/useThreadGapRecovery';
import { useThreadEditBackfillController } from '../threads/open/threadEditBackfillController';
import { useThreadSummaryPublishController } from '../threads/summary/threadSummaryPublishController';
import { useThreadSummaryTimeline } from '../threads/summary/useThreadSummaryTimeline';
import {
  ThreadConversationCostProvider,
  useThreadConversationCostSummary,
} from '../event-store/threads/useThreadConversationCost';
import {
  useThreadApprovalRowMeasurements,
  useThreadApprovalTimeline,
} from '../approvals/useThreadApprovalTimeline';
import { isTimelineAtLiveEnd } from '../event-store/timeline/timelineScrollUtils';
import { useFooterBottomPin } from './useFooterBottomPin';
import { listShrinkNotRendered, useListEndClamp } from './useListEndClamp';
import { ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE } from '../event-store/cache/preloadSettings';
import type { ThreadSummaryWriter } from '../event-store/threads/threadSummaryState';
import { isLocalEchoEventId } from '../event-store/threads/threadRouteUtils';
import { useThreadOpeningReveal } from './useThreadOpeningReveal';
import { useViewScopedFlag } from './roomTimelineViewScope';
import {
  heldListHeight,
  isNearLatestEnd,
  useGestureBottomPins,
  useLatestPinAsked,
  useLatestRowPin,
  useRowsGeneration,
  useThreadReturnPlace,
  useTimelineRowJumps,
  useTimelineScrollElement,
  useViewportAtBottomNow,
  type RoomRowsPlace,
} from './roomTimelineScroll';
import {
  useRelinkKeepingRows,
  useRetryAfterEmptyBackPage,
  useRoomRowRemoval,
  useRoomThreadDeleted,
  useRoomWindowPaginator,
  useThreadAutoPaginateBack,
  useWindowKeepsNewestRow,
} from './roomTimelinePaginationWindow';
import {
  offersJumpToUnread,
  UnreadActions,
  useMarkRoomAsRead,
  useRoomUnreadInfo,
  useShownInScrollArea,
} from './roomTimelineUnread';
import { useMessageRowHidden } from '../plugins/messageRenderers';
import { isPluginHiddenRow } from './pluginHiddenRows';
import { renderTimelineTiles, timelineRowSizing, useRoomRowEntries } from './roomTimelineRows';
import { collectThreadWriterIds, recordThreadWriters } from '../event-store/threads/threadWriters';
import { useThreadWritersBackfill } from '../threads/overview/useThreadWritersBackfill';
import type { FetchedRelationOverviewUpdateOptions } from '../threads/overview/threadOverviewCacheHydration';
import { countsRoomRows } from './roomTimelineClassicRows';
import {
  ExpandAllLine,
  FilterBarSlot,
  JumpToLatestAction,
  ThreadLoadingLines,
  footerProbeStyle,
  listTopSentinelStyle,
  roomViewStyleUnder,
  threadBannerSlotStyle,
  threadViewStyle,
} from './RoomTimelineOverlays';

export type RoomTimelineProps = {
  room: Room;
  eventId?: string;
  threadId?: string;
  /** Show a permalinked thread root in the room instead of opening its thread. */
  focusEventInRoom?: boolean;
  summaryMap: ReadonlyMap<string, ThreadSummaryInfo>;
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
  onToggleUnresolvedOnly?: () => void;
  onTogglePerson?: (userId: string) => void;
  onClearPeople?: () => void;
  onReset?: () => void;
  onAddTag?: (tag: string) => void;
  onRemoveTag?: (tag: string) => void;
  onClearTags?: () => void;
  onApplyPreset?: (preset: FilterPreset) => void;
  onSearchQueryChange?: (query: string) => void;
  viewMode: RoomViewMode;
  /** Accepted from the room view; the switch itself lives in the room header. */
  onViewModeChange?: (viewMode: RoomViewMode) => void;
  roomInputRef?: RefObject<HTMLElement>;
  compactRoomScrollStateRef?: MutableRefObject<ScrollAnchorMemory>;
  /** Where the room's rows were when a thread opened over them (`useThreadReturnPlace`). */
  threadReturnPlaceRef?: MutableRefObject<RoomRowsPlace | undefined>;
  editor: Editor;
  /** Called when the open thread's root cannot be loaded at all. */
  onThreadLoadError?: (threadId: string) => void;
  /** Shown above an open thread's rows, inside its scroll area. */
  threadHeader?: ReactNode;
};

type ScrollToBottomState = { count: number; smooth: boolean };

const EMPTY_EVENTS: MatrixEvent[] = [];
const EMPTY_IDS: ReadonlySet<string> = new Set();
/** Stand-ins for filter bar handlers a caller leaves out. */
const ignoreFilterChange = () => undefined;
const ignoreSortFreezeUpdate: Dispatch<SetStateAction<ThreadSortFreezeState | null>> = () =>
  undefined;

/** The display settings the timeline follows, each read on its own so a change re-renders. */
const useTimelineDisplaySettings = () => ({
  hideActivity: !!useSettingValue(settingsAtom, 'hideActivity'),
  hideMembershipEvents: !!useSettingValue(settingsAtom, 'hideMembershipEvents'),
  hideNickAvatarEvents: !!useSettingValue(settingsAtom, 'hideNickAvatarEvents'),
  messageLayout: useSettingValue(settingsAtom, 'messageLayout'),
  messageSpacing: useSettingValue(settingsAtom, 'messageSpacing'),
  showHiddenEvents: !!useSettingValue(settingsAtom, 'showHiddenEvents'),
  hideThreadFilterBar: !!useSettingValue(settingsAtom, 'hideThreadFilterBar'),
  prefetchDepth: sanitizePrefetchDepth(useSettingValue(prefetchSettingsAtom, 'prefetchDepth')),
});

/** Where a focused Compact card without a saved place sits: its top this far below the list's. */
const COMPACT_FOCUSED_CARD_OFFSET_PX = 160;

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
  const engine = useSyncEngine();
  const { sessionId } = engine;
  const { t } = useTranslation();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
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
    hideThreadFilterBar,
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
  const fallbackThreadReturnPlaceRef = useRef<RoomRowsPlace>();

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
  // Reads the newest filters, so it changes identity only with the room.
  const buildInitialTimeline = useCallback((): Timeline => {
    const { room: filterRoom, ...filters } = filterOptsRef.current;
    return countsRoomRows(getInitialTimeline(filterRoom, windowLimitRef.current, filters));
  }, [filterOptsRef, windowLimitRef]);
  const [timeline, setTimeline] = useState<Timeline>(buildInitialTimeline);
  const [roomHasMoreCachedBack, setRoomHasMoreCachedBack] = useState(false);
  const [roomInitialCacheHydratedKey, setRoomInitialCacheHydratedKey] = useState<string>();
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useLatestRef(atBottom);
  const [focusItem, setFocusItem] = useState<RoomTimelineFocusItem>();
  const focusItemRef = useLatestRef(focusItem);
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
  const { renderableEventEntries, renderableEvents, windowTimeline } = useRoomRowEntries({
    room,
    threadId,
    timeline,
    setTimeline,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    showThreadRepliesInRoom,
  });

  const threadResolutionMap = useRoomThreadResolutionMap(room);
  const threadIndex = useThreadIndex({
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
      info: ThreadSummaryInfo | undefined
    ) => void,
  });

  // Compact shows the room's threads as cards (a link to a message outside them shows the room's
  // timeline instead). It reads no message of the room's main timeline by being open, also while
  // a room without a thread shows its timeline under the bar until a first message makes a card.
  const compactCards = compactViewRequested && !threadIndex.focusedRoomOverviewBypass;

  const threadRecordMapRef = useLatestRef(threadIndex.threadRecordMap);
  // The Threads view under the bar's Last Reply sort, newest first, lists the newest thread first:
  // the top is its latest end, where it opens, where a new message lands and where it follows.
  const { sortBy, sortDirection } = threadIndex.effectiveThreadFilterState;
  const latestAtTop =
    !threadId &&
    !compactViewRequested &&
    threadIndex.roomThreadFilterActive &&
    sortBy === 'lastReply' &&
    sortDirection === 'desc';
  const latestAtTopRef = useLatestRef(latestAtTop);
  // Rows that wrap anew at another width still end at the bottom, as after a send.
  const followLatestRows = useCallback(() => {
    if (latestAtTopRef.current) return;
    const { count } = scrollToBottomRef.current;
    scrollToBottomRef.current = { count: count + 1, smooth: false };
  }, [latestAtTopRef]);
  useFooterBottomPin(scrollElement, footerProbeRef, followLatestRows);
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
  // The classic view's mounted rows hold thread replies: reading the room reads their threads.
  const roomWindowRowsRef = useLatestRef(roomWindowRows);
  const classicRows = useMemo(
    () => (showThreadRepliesInRoom ? () => roomWindowRowsRef.current : undefined),
    [roomWindowRowsRef, showThreadRepliesInRoom]
  );

  useWindowKeepsNewestRow({
    activeTimelineRange,
    eventId,
    roomRowCount: roomRows.length,
    threadId,
    setTimeline,
  });

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
  // Replies in a thread a plugin's renderer hides (`MessageRenderer.hidden`); the one the route or
  // a jump opened keeps its row.
  const messageRowHidden = useMessageRowHidden(mx.getUserId() ?? undefined);
  const focusEventId = focusItem?.eventId;
  const isHiddenByPlugin = useMemo(() => {
    const revealed = new Set([eventId, focusEventId].filter((id): id is string => !!id));
    return (event: MatrixEvent) =>
      isPluginHiddenRow(event, getRowContent, messageRowHidden, revealed);
  }, [eventId, focusEventId, getRowContent, messageRowHidden]);
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

  // While the opening room view does not fill the screen, keep paginating. The fill holds the
  // last row still while the rows above it measure, so a view whose newest row is its first
  // (which loads older history at its bottom sentinel) does without it.
  const roomSurfaceShown = !threadId && !compactViewRequested;
  const threadReturnPlace = useThreadReturnPlace({
    memoryRef: props.threadReturnPlaceRef ?? fallbackThreadReturnPlaceRef,
    roomId: room.roomId,
    threadId,
    eventId,
    roomRowsShown: roomSurfaceShown,
    latestAtTop,
    scrollRef,
  });
  const automaticFill = useRoomAutomaticFill({
    viewKey,
    enabled: roomSurfaceShown && !eventId && !latestAtTop,
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
    filterOptsRef
  );
  const paginateRoom = useRoomPaginationCommandController({
    alive,
    handleTimelinePagination,
    mx,
    beginRoomCacheWrite,
    recalibrateFilterOptsRef: filterOptsRef,
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
  const {
    paginator,
    pendingRoomFoldPxRef,
    roomFoldWindowRef,
    roomFoldPriceRef,
    roomBackPage,
    getRoomRowElement,
  } = useRoomWindowPaginator({
    alive,
    roomRows,
    roomRowsRef,
    activeTimelineRange,
    activeRangeRef,
    threadIdRef,
    firstRoomTimelineRef,
    scrollRef,
    setTimeline,
    paginateRoom,
    suppressFocusPaginationRef,
    windowLimit,
    getScrollElement,
    deferAutomaticPagination: automaticFill.defer,
    // The Threads view, newest first, lists every thread from the room's thread list: history
    // brings it only the messages without a thread, as the reader reaches them.
    readAhead: !latestAtTop,
  });

  // The virtual list and its offset ledger.
  const itemCount = threadId ? threadEvents.length : roomWindowRows.length;
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
  const { estimateSize, getItemKey } = timelineRowSizing({
    threadId,
    compactLayout,
    showThreadRepliesInRoom,
    threadEvents,
    roomWindowRows,
    windowStart: activeTimelineRange.start,
    roomRowsRef,
    activeRangeRef,
    threadRecordMapRef,
  });
  const showThreadLoadOlder = !!threadId && windowState.showThreadLoadOlderMessages;
  const threadLoadError = !!threadId && session.snapshot.open.loadError;
  const threadLoading =
    !!threadId && threadEvents.length === 0 && threadInitialRenderMode === 'loading';
  // Replaced room rows (not added ones) start the ledger over, as another room does.
  const rowsGeneration = useRowsGeneration(timeline.linkedTimelines);
  // The Threads view, newest first, keeps a reader who scrolled down where they are while rows land
  // above them: threads that arrive at its top, and in a message link's window (where leaving a
  // thread opened from a link comes back) pages of newer history. A reader at the top sees them
  // arrive. The render that asks for the newest rows (Jump to Latest, a send) keeps nothing: the
  // reader's row recorded before it can sit far below the rows that replace a link's window.
  const anchorBelowLatestEnd = useCallback(() => {
    const scrollArea = getScrollElement();
    return !!scrollArea && !isNearLatestEnd(scrollArea, true);
  }, [getScrollElement]);
  const latestPinAsked = useLatestPinAsked(scrollToBottomRef);
  const ledger = useTimelineScrollLedgerController({
    alive,
    anchorRoomRows: latestAtTop && !latestPinAsked ? anchorBelowLatestEnd : undefined,
    estimateSize,
    getItemKey,
    getScrollElement,
    itemCount,
    pendingRoomFoldPxRef,
    // virtual-core renders at once when the reader scrolls, which can come before the update of
    // a window widened over older rows: that render keeps the window the fold was priced for.
    roomFoldHeld: activeTimelineRange === roomFoldWindowRef.current,
    roomFoldPriceRef,
    roomId: room.roomId,
    rowsKey: threadId ? undefined : rowsGeneration,
    threadEventIndexMap,
    threadEvents,
    threadId,
    threadInitialRenderMode,
    leadingKey: threadId
      ? [
          threadLoadError ? 'error' : '',
          showThreadLoadOlder ? 'older' : '',
          threadLoading ? 'loading' : '',
        ].join('|')
      : roomSurfaceShown && !latestAtTop
      ? ['room', showRoomIntro ? 'intro' : '', itemCount > 0 ? 'toggle' : ''].join('|')
      : '',
    automaticFill: roomSurfaceShown
      ? { isActive: automaticFill.isActive, geometryReader: automaticFill.geometryReader }
      : undefined,
  });
  const { virtualizer } = ledger;
  const virtualizerRef = useLatestRef(virtualizer);
  // How far the list still reaches below its newest row (`listShrinkNotRendered`).
  const { virtualInnerRef, readRowFoldPx } = ledger;
  const pendingListShrinkPx = useCallback(
    () =>
      listShrinkNotRendered(
        virtualInnerRef.current,
        virtualizerRef.current.measurementsCache,
        readRowFoldPx()
      ),
    [readRowFoldPx, virtualInnerRef, virtualizerRef]
  );
  // virtual-core corrects the scroll position in its ResizeObserver callback, and the ledger renders
  // the moved rows before the paint, inside the browser's ResizeObserver loop. That render keeps the
  // list's bottom edge where it is and the next one takes the new height: moving it there would
  // resize the scroll content, which the scrollbar, the minimap and the follow-growth observer
  // watch, after the rows inside it were reported, and WebKit then reports "ResizeObserver loop
  // completed with undelivered notifications". A correction the ledger took in the same pass moves
  // the list's top (its negative top margin) in that render, so the held height takes the
  // difference; the rows paint where they belong either way.
  // A row that changed size in place renders the rows after it the same way.
  // That render keeps the rows it had, too, and the next one mounts the rows the window gained:
  // virtual-core observes a row as it mounts, so a row mounted inside the loop is observed at the
  // depth of the rows just reported, and the browser skips it and reports the loop (closing the
  // message editor shrank its row, and the window gained a row above). Those rows are overscan.
  const renderedList = ledger.virtualInnerRef.current?.style;
  const beforePaint = ledger.unrenderedCorrectionPx() !== 0 || ledger.unrenderedRowMove();
  const listHeight =
    beforePaint && renderedList?.height
      ? heldListHeight(renderedList, ledger.ledgerPxAtRender)
      : virtualizer.getTotalSize();
  useThreadApprovalRowMeasurements(
    virtualizer,
    threadEvents,
    threadId ? approvalTimeline.hiddenEventIds : EMPTY_IDS,
    estimateSize
  );

  // Jumps: the paginator scrolls to mounted rows and moves the window; the virtual list
  // scrolls to the rows of the window it has not mounted.
  const {
    scrollToItem: paginatorScrollToItem,
    scrollToElement: paginatorScrollToElement,
    retryPagination,
  } = paginator;
  useRetryAfterEmptyBackPage(roomBackPage, roomRowsRef, retryPagination);
  const { scrollToItem, scrollToElement, scrollThreadEventIntoView } = useTimelineRowJumps({
    paginatorScrollToItem,
    paginatorScrollToElement,
    activeRangeRef,
    virtualizerRef,
    threadEventIndexMapRef,
    onJump: ledger.endSettleDiscardWatch,
    rows: { getScrollElement, getRowElement: getRoomRowElement, roomRowsRef },
  });
  const cancelThreadBottomSettle = useCallback(
    () => backController.suppressOpenBottomPin(),
    [backController]
  );
  const requestThreadOpenBottomPin = useCallback(
    () => backController.requestOpenBottomPin(scrollToBottomRef),
    [backController]
  );
  const gesturePins = useGestureBottomPins({
    backController,
    scrollToBottomRef,
    readerScrolledRef,
    onFirstGesture: forceRender,
  });

  const effectiveThreadFilterStateRef = useLatestRef(threadIndex.effectiveThreadFilterState);
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
    recalibrateFilterOptsRef: filterOptsRef,
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
    readMeasurementCorrectionPx: ledger.readMeasurementCorrectionPx,
    cancelThreadBottomSettle,
    alive,
    atBottomAnchorRef,
    editId: feature.editingEventId,
    focusItem,
    focusScrollResetToken: room.roomId,
    latestAtTopRef,
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
    cancelThreadOpenBottomPin: gesturePins.onThreadGesture,
    shouldApplyThreadBottomPin: gesturePins.shouldApplyBottomPin,
    threadEventIndexMapRef,
    threadEventsLength: threadEvents.length,
    threadFilteredEvents: roomRows,
    threadFilteredEventsRef: roomRowsRef,
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
  // After the pins above: a thread opening at its newest reply shows its rows once they rest there
  // (a local echo root, a thread still being created, has no open to wait for).
  const hideOpeningThreadRows = useThreadOpeningReveal({
    viewKey,
    opensAtLatest: !!threadId && !eventId && !isLocalEchoEventId(threadId),
    rowCount: threadEvents.length,
    scrollRef,
    readerTookOver: () =>
      readerScrolledRef.current.value || backController.isOpenBottomPinSuppressed(),
  });

  const {
    handleJumpToLatest: showLatestRows,
    handleJumpToUnread,
    handleOpenReply,
  } = useRoomTimelineNavigationController({
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
  // Jump to Latest also ends the jump to a linked message: until its row rests, that jump scrolls
  // back to it whenever the row or the scroll area resizes, as the latest rows do when they render.
  const handleJumpToLatest = useCallback(() => {
    setFocusItem(undefined);
    showLatestRows();
  }, [showLatestRows]);

  // A message the reader sends shows at once: the view goes to the rows' latest end, through the
  // live window when it has left it, as Jump to Latest does. Compact opens the sent thread instead.
  const followOwnSend = useCallback(() => {
    if (compactViewRequested) return;
    if (!atLiveEndRef.current) {
      handleJumpToLatest();
      return;
    }
    const { count } = scrollToBottomRef.current;
    scrollToBottomRef.current = { count: count + 1, smooth: false };
  }, [atLiveEndRef, compactViewRequested, handleJumpToLatest]);

  const { handleMarkAsRead } = useTimelineReadReceiptController({
    atBottom,
    atBottomAnchorRef,
    atBottomRef,
    atLiveEndRef,
    getScrollElement,
    latestAtTop,
    handleOpenEvent,
    hideActivity,
    mx,
    readUptoEventIdRef,
    readsMainTimeline: !compactCards,
    room,
    setAtBottom,
    classicRows,
    threadEventsLength: threadEvents.length,
    threadId,
    threadInitialRenderMode,
    threadEvents,
    threadTailLoaded,
    timelineAtLiveEnd,
    unreadInfo,
  });

  const markRoomAsRead = useMarkRoomAsRead(handleMarkAsRead, setUnreadInfo, threadId);

  useRoomCacheHydrationController({
    alive,
    buildInitialTimeline,
    eventId,
    focusItemRef,
    mx,
    recalibrateFilterOptsRef: filterOptsRef,
    room,
    roomDebugTraceId,
    roomIdRef,
    scrollToBottomRef,
    sessionId,
    setAtBottom,
    setFocusItem,
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
  const isViewportAtLatestNow = useViewportAtBottomNow(scrollRef, atBottomRef, latestAtTopRef);
  const setRelinkedTimeline = useRelinkKeepingRows({
    alive,
    mx,
    filterOptsRef,
    rebuildTimeline: buildInitialTimeline,
    setTimeline,
  });
  useRoomTimelineResetRelink({
    room,
    threadId,
    eventId,
    timeline,
    rebuildTimeline: buildInitialTimeline,
    setTimeline: setRelinkedTimeline,
    isViewportAtBottomNow: isViewportAtLatestNow,
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
    room.roomId,
    pendingListShrinkPx
  );
  // After the follow above and every other observer of the timeline (it is created last).
  useListEndClamp(scrollElement, contentRef, footerProbeRef, pendingListShrinkPx);

  // The compact overview: older history until zero-reply roots show up, root edits it lacks (the
  // Threads view's too, which lists the same roots), and a refresh of its threads when the page
  // comes back.
  const loadedRoomEventCount = useMemo(
    () => timeline.linkedTimelines.reduce((total, part) => total + part.getEvents().length, 0),
    [timeline]
  );
  useCompactCoverageBackfillController({
    roomId: room.roomId,
    enabled: compactViewRequested && !eventId,
    loadedEventCount: loadedRoomEventCount,
    hasZeroReplyRootCoverage: threadIndex.hasZeroReplyRootCoverage,
    canPaginateBack: canPaginateRoomBack,
    hasMoreCachedBack: roomHasMoreCachedBack,
    paginateBack: paginateRoom,
  });
  useCompactRootEditBackfillController({
    enabled: compactViewRequested || threadIndex.roomThreadFilterActive,
    mx,
    overviewThreadRootIds: threadIndex.overviewThreadRootIds,
    beginRoomCacheWrite,
    room,
    roomSurfaceEventEntries: threadIndex.roomSurfaceEventEntries,
    roomThreadListThreads: threadIndex.roomThreadListThreads,
    setOverviewRefreshCounter,
  });
  // Every fetched thread page also tells who wrote in the thread.
  const { applyThreadOverviewRelationEvents } = threadIndex;
  const applyThreadRelations = useCallback(
    (options: FetchedRelationOverviewUpdateOptions) => {
      recordThreadWriters(
        options.room,
        options.rootId,
        collectThreadWriterIds(options.events, options.rootId),
        options.relationSnapshotComplete === true
      );
      applyThreadOverviewRelationEvents(options);
    },
    [applyThreadOverviewRelationEvents]
  );
  // Once the People list was opened in this room, or a person is chosen, the threads whose
  // writers the cache cannot complete are read from the server.
  const [peopleListOpened, setPeopleListOpened] = useState<string>();
  const onPeopleListShown = useCallback(() => setPeopleListOpened(room.roomId), [room.roomId]);
  const peopleInUse =
    peopleListOpened === room.roomId || (threadFilterState.people?.length ?? 0) > 0;
  useThreadWritersBackfill({
    room,
    mx,
    sessionId,
    records: compactViewRequested
      ? threadIndex.compactThreadRecordMap
      : threadIndex.normalThreadRecordMap,
    fetchMissing: peopleInUse && !threadId,
    onApplyThreadRelations: applyThreadRelations,
    onStoreThreadSummary,
    beginThreadCacheWrite,
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
      info: ThreadSummaryInfo | undefined
    ) => void,
    onApplyThreadRelations: applyThreadRelations,
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
    readsMainTimeline: !compactCards,
    hideMembershipEvents,
    hideNickAvatarEvents,
    ignoredUsersSet,
    markLiveExpansionCandidate: feature.markLiveExpansionCandidate,
    latestAtTopRef,
    onOwnSend: followOwnSend,
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
    classicRows,
    threadEventIndexMapRef,
    threadId,
    threadResolutionMap,
    timelineAtLiveEnd,
    unreadInfo,
  });

  // Scrolling near the top of a thread's loaded rows asks for older ones.
  const windowItems = virtualizer.getVirtualItems();
  const mountedRowKeysRef = useRef<ReadonlySet<VirtualItem['key']>>();
  const mountedRowKeys = mountedRowKeysRef.current;
  const virtualItems =
    beforePaint && mountedRowKeys
      ? windowItems.filter((item) => mountedRowKeys.has(item.key))
      : windowItems;
  useLayoutEffect(() => {
    mountedRowKeysRef.current = new Set(virtualItems.map((item) => item.key));
  });
  const threadPaginatingBack = threadPagination.isPending('backward');
  useThreadAutoPaginateBack({
    scrollElement,
    virtualizerRef,
    threadId,
    paginatingBack: threadPaginatingBack,
    showLoadOlder: showThreadLoadOlder,
    hasUserScrollIntent: threadUserScrolled,
    paginateBack: threadPagination.paginateBack,
  });

  // Back from a thread shows the room's rows where the reader left them: once their row is among
  // the rows, it jumps there.
  const returnRowIndex = threadReturnPlace
    ? roomRows.findIndex((event) => event.getId() === threadReturnPlace.eventId)
    : -1;
  const returnedRef = useRef(false);
  useLayoutEffect(() => {
    if (!threadReturnPlace || returnRowIndex === -1 || returnedRef.current) return;
    returnedRef.current = true;
    const { eventId: placeEventId, offset } = threadReturnPlace;
    setFocusItem({
      eventId: placeEventId,
      index: returnRowIndex,
      scrollTo: true,
      highlight: false,
      offset,
    });
  }, [returnRowIndex, threadReturnPlace]);

  // The newest row of the room or the open thread, while a request for it holds.
  const threadRowsPinned = threadUserScrolled ? 'thread' : undefined;
  const roomRowsPinned = roomSurfaceShown ? 'room' : undefined;
  useLatestRowPin({
    surface: threadId ? threadRowsPinned : roomRowsPinned,
    itemCount,
    virtualizer,
    // A room with unread rows opens at its unread marker instead (roomFocusScrollController),
    // unless its newest row is first; the way back from a thread at the place the reader left.
    opensAtLatest:
      !eventId &&
      !threadReturnPlace &&
      (latestAtTop || !(unreadInfo?.scrollTo && unreadInfo.inLiveTimeline)),
    latestAtTop,
    roomId: room.roomId,
    scrollElement,
    scrollToBottomRef,
    committedView: `${viewKey}|${effectiveViewMode}`,
    focusItem,
    onReaderGesture: gesturePins.onRoomGesture,
    pendingListShrinkPx,
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

  // Older roots without replies are in older history: it loads as the reader nears the cards' end.
  const compactHostRef = useRef<HTMLDivElement>(null);
  useCompactHistoryAtEnd({
    enabled: compactCards && threadIndex.showCompactRoomView && !eventId,
    roomId: room.roomId,
    hostRef: compactHostRef,
    canPaginateBack: canPaginateRoomBack,
    hasMoreCachedBack: roomHasMoreCachedBack,
    paginateBack: paginateRoom,
  });
  // The header's filter button hides the bar; the filters keep applying while it is hidden.
  const filterBarShown =
    showRoomThreadOverviewControls && !plainConversation && !hideThreadFilterBar;
  const filterBar = filterBarShown && (
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
        onToggleUnresolvedOnly={props.onToggleUnresolvedOnly ?? ignoreFilterChange}
        onReset={props.onReset ?? ignoreFilterChange}
        onAddTag={props.onAddTag ?? ignoreFilterChange}
        onRemoveTag={props.onRemoveTag ?? ignoreFilterChange}
        onClearTags={props.onClearTags ?? ignoreFilterChange}
        onApplyPreset={props.onApplyPreset ?? ignoreFilterChange}
        onSearchQueryChange={props.onSearchQueryChange ?? ignoreFilterChange}
        peopleFilter={
          props.onTogglePerson && (
            <ThreadPeopleFilter
              room={room}
              records={
                compactCards
                  ? threadIndex.compactThreadRecordMap
                  : threadIndex.normalThreadRecordMap
              }
              selected={threadFilterState.people}
              onShown={onPeopleListShown}
              onToggle={props.onTogglePerson}
              onClear={props.onClearPeople ?? ignoreFilterChange}
            />
          )
        }
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
    // Leaving a thread comes back here focused on its root. One opened from its card finds the
    // place the list saved with that card in view; one opened from a link has none, so its card
    // takes a place below the bar, and the list's memory brings it there as cards render.
    const savedPlace = compactRoomScrollStateRef.current.get(room.roomId);
    if (
      eventId &&
      focusEventInRoom &&
      !savedPlace?.anchors.some((anchor) => anchor.key === eventId)
    ) {
      compactRoomScrollStateRef.current.set(room.roomId, {
        scrollTop: 1,
        anchors: [{ key: eventId, offset: COMPACT_FOCUSED_CARD_OFFSET_PX }],
      });
    }
    return (
      <Box ref={compactHostRef} grow="Yes" direction="Column" style={roomStyle}>
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
  const tiles = renderTimelineTiles({
    virtualItems,
    threadId,
    threadEvents,
    roomWindowRows,
    roomRowEntries,
    windowStart: activeTimelineRange.start,
    // With the newest row first, the line would mark the newest row rather than where the reader
    // stopped; that view draws none (as MindRoom Chat), and reading at its top reads the room.
    readUptoAbsoluteIndex: latestAtTop ? undefined : windowState.readUptoAbsoluteIndex,
    ignoredUsersSet,
    showHiddenEvents,
    timelineSet: (threadId && threadState.threadTimelineSet) || room.getUnfilteredTimelineSet(),
    focusItem,
    messageData,
    isHiddenByPlugin,
    renderEvent: feature.renderEvent,
    unreadMarkerRef: setUnreadMarker,
    measureElement: ledger.measureElement,
    ledgerPxAtRender: ledger.ledgerPxAtRender,
  });

  // Nothing to jump to without the line; the newest-first view opens at the unread rows anyway.
  const showJumpToUnread =
    !latestAtTop &&
    offersJumpToUnread({
      threadId,
      unreadInfo,
      roomUnread,
      unreadMarkerShown,
    });
  // In the room the toggle takes a line of its own above the rows; a thread has none. A phone's
  // unread pills, as wide as the line nearly, sit at its height: while they show, the toggle moves
  // to the line's start and they keep clear of it there.
  const expandAllToggle = itemCount > 0 && (
    <ExpandAllLine
      expanded={expandAll}
      onToggle={handleToggleExpandAll}
      atStart={phone && showJumpToUnread}
    />
  );
  // The room's start (its intro and the sentinel that loads older history) and newer history
  // (the front sentinel) sit at the ends where their rows are: with the newest row first, older
  // history is at the bottom. The sentinel above the rows sits inside the list, at its top, where
  // its first row is: rows the offset ledger holds above the reader count as loaded.
  const roomIntro =
    showRoomIntro && (compactCards ? <CompactRoomWithoutThreads /> : <RoomIntro room={room} />);
  const backSentinel = showRoomBackSentinel && (
    <div
      ref={paginator.observeBackAnchor}
      style={latestAtTop ? { height: 1 } : listTopSentinelStyle}
    />
  );
  const frontSentinel = showRoomFrontSentinel && (
    <div
      ref={paginator.observeFrontAnchor}
      style={latestAtTop ? listTopSentinelStyle : { height: 1 }}
    />
  );
  // Marks the rows' latest end for Jump to Latest and the read receipts.
  const latestEndAnchor = <span ref={atBottomAnchorRef} style={{ display: 'block', height: 0 }} />;

  return (
    <Box grow="Yes" direction="Column" style={threadId ? threadViewStyle : roomStyle}>
      <div ref={footerProbeRef} aria-hidden style={footerProbeStyle} />
      {filterBar}
      {showJumpToUnread && (
        <UnreadActions
          onJumpToUnread={handleJumpToUnread}
          onMarkAsRead={markRoomAsRead}
          clearStart={phone}
        />
      )}
      <Scroll ref={attachScroll} className={overlay.Scroll} visibility="Hover" size="300">
        {latestAtTop && latestEndAnchor}
        <Box
          ref={contentRef}
          direction="Column"
          justifyContent={threadId || compactCards || latestAtTop ? 'Start' : 'End'}
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
                  onResize={ledger.holdThreadBannerResize}
                  scrollRef={scrollRef}
                >
                  <div style={threadBannerSlotStyle}>{threadHeader}</div>
                </ThreadTimelineHeader>
              )}
              <div ref={ledger.leadingRef}>
                <ThreadLoadingLines
                  loadError={threadLoadError}
                  showLoadOlder={showThreadLoadOlder}
                  paginatingBack={threadPaginatingBack}
                  loading={threadLoading}
                  onLoadOlder={handleLoadOlderThread}
                />
              </div>
            </>
          ) : (
            <div ref={ledger.leadingRef}>
              {!latestAtTop && roomIntro}
              {expandAllToggle}
            </div>
          )}
          <ThreadConversationCostProvider value={threadConversationCost}>
            {feature.wrapExpansion(
              <div
                ref={ledger.virtualInnerRef}
                data-thread-count={threadId ? threadEvents.length : undefined}
                data-testid={threadId ? undefined : 'room-virtual-inner'}
                style={{
                  position: 'relative',
                  height: listHeight,
                  visibility:
                    automaticFill.hideInitialRows || hideOpeningThreadRows ? 'hidden' : undefined,
                }}
              >
                {latestAtTop ? frontSentinel : backSentinel}
                {tiles}
              </div>
            )}
          </ThreadConversationCostProvider>
          {latestAtTop ? (
            <>
              {roomIntro}
              {backSentinel}
            </>
          ) : (
            frontSentinel
          )}
        </Box>
        {/* After the content's padding, so "at the bottom" means the end of the scroll range,
            not the last row, which sits a composer's height higher, behind the footer. */}
        {!latestAtTop && latestEndAnchor}
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
      {!atBottom && <JumpToLatestAction onSelect={handleJumpToLatest} up={latestAtTop} />}
    </Box>
  );
}
