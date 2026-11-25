import type { ThreadWorkflowTab } from '../event-store/threads/threadWorkflow';
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
} from 'react';
import { Direction, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { Editor } from 'slate';
import { Box, Spinner } from 'folds';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useAlive } from '../lib/hooks/useAlive';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { useIgnoredUsers } from '../matrix/hooks/useIgnoredUsers';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { useInitialClientCatchup } from '../matrix/hooks/useInitialClientCatchup';
import { useRoomUnread } from '../matrix/state/useUnread';
import { roomToUnreadAtom } from '../matrix/state/roomToUnread';
import { MessageLayout } from '../preferences/settings';
import { getEditedEvent, getLatestMessageContent } from '../matrix/room';
import { RoomIntro } from './RoomIntro';
import { useSyncEngine } from '../event-store/engine';
import type { ThreadSummaryInfo } from '../matrix/protocol/threadSummary';
import type { ScrollAnchorMemory } from '../ui/scrollAnchorMemory';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { CompactRoomView } from '../threads/overview/CompactRoomView';
import { takeCompactFocusRequest } from '../threads/overview/compactFocusRequest';
import { CompactRoomWithoutThreads } from './CompactRoomWithoutThreads';
import { useTimelineMessageFeature } from './message-rendering/useTimelineMessageFeature';
import type { TimelineMessageData } from './message-rendering/types';
import type { RoomViewMode } from '../navigation/roomViewMode';
import type {
  ThreadFilterState,
  ThreadSortFreezeState,
} from '../event-store/threads/roomThreadOverviewModel';
import { RoomThreadOverview } from '../threads/overview/RoomThreadOverview';
import { ThreadPeopleFilter } from '../threads/overview/ThreadPeopleFilter';
import { useThreadSortFreezeController } from '../threads/overview/threadSortFreezeController';
import {
  DIRECT_ROOM_TIMELINE_FILTER_STATE,
  listedThreadFilterState,
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
import {
  clearVirtualizerHoldOffset,
  useTimelineScrollLedgerController,
} from './timelineScrollLedgerController';
import { useRoomAutomaticFill } from './roomAutomaticFill';
import { useThreadAwareTimelineRefresh } from './useThreadAwareTimelineRefresh';
import { useCompactCoverageBackfillController } from '../threads/overview/compactCoverageBackfillController';
import { useCompactHistoryAtEnd } from '../threads/overview/useCompactHistoryAtEnd';
import { useCompactRootEditBackfillController } from '../threads/overview/compactRootEditBackfillController';
import { useThreadOverviewResumeController } from '../threads/overview/threadOverviewResumeController';
import { getLiveReplyStore } from '../messages/live/liveReplyStore';
import {
  useThreadOverviewListenedFirst,
  useThreadOverviewRefreshCounter,
  type ThreadOverviewRefresh,
} from '../threads/overview/threadOverviewRefreshCounter';
import { useTimelineDebugTraceIds } from './timelineDebugController';
import { useThreadIndex } from '../threads/overview/useThreadIndex';
import { useRoomThreadResolutionMap } from '../threads/tags/useRoomThreadTags';
import { useThreadSeedPrewarmController } from '../threads/open/threadSeedPrewarmController';
import { useThreadSummaryPublishController } from '../threads/summary/threadSummaryPublishController';
import type { ThreadSummaryTimelinePlan } from '../event-store/threads/threadSummaryTimeline';
import { useThreadApprovalTimeline } from '../approvals/useThreadApprovalTimeline';
import { useVoiceTranscriptPlan } from '../messages/voiceTranscripts';
import { NO_REPLY_CARDS } from './replyCards';
import { NO_MODEL_CHANGES } from '../messages/modelChanges';
import { isMindroomResponderForViewer } from '../matrix/protocol/agentIdentity';
import { isTimelineAtLiveEnd } from '../event-store/timeline/timelineScrollUtils';
import { useHeldRowsLayout, useTimelineLiveEnd } from './timelineLiveEnd';
import {
  ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE,
  THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS,
} from '../event-store/cache/preloadSettings';
import type { ThreadSummaryWriter } from '../event-store/threads/threadSummaryState';
import { getKnownThreadReplyCount } from '../event-store/threads/threadRecord';
import { useViewScopedFlag, useViewScopedState } from './roomTimelineViewScope';
import {
  isNearLatestEnd,
  useFlickStop,
  useGestureBottomPins,
  useLatestPinAsked,
  useThreadReturnPlace,
  useTimelineRowJumps,
  useViewportAtBottomNow,
  type RoomRowsPlace,
} from './roomTimelineScroll';
import {
  useRelinkKeepingRows,
  useRetryAfterPageWithoutRows,
  useRoomRowRemoval,
  useRoomThreadDeleted,
  useRoomWindowPaginator,
  useWindowHoldsWholeFolds,
  useWindowKeepsNewestRow,
} from './roomTimelinePaginationWindow';
import {
  offersJumpToUnread,
  UnreadActions,
  useMarkRoomAsRead,
  useRoomUnreadInfo,
  useShownInScrollArea,
} from './roomTimelineUnread';
import { loadedRangeOfRows, rowIndexOfLoaded, type RenderedRoomRows } from './membershipFolds';
import {
  NO_RENDERED_ROOM_ROWS,
  forgetFormedFoldHeights,
  useMembershipFoldRowSizes,
  useMembershipFolds,
  useRoomRowWindow,
} from './useMembershipFolds';
import {
  isTimelineRowHidden,
  renderTimelineTiles,
  timelineRowSizing,
  useRoomRowEntries,
} from './roomTimelineRows';
import { collectThreadWriterIds, recordThreadWriters } from '../event-store/threads/threadWriters';
import { useThreadWritersBackfill } from '../threads/overview/useThreadWritersBackfill';
import type { FetchedRelationOverviewUpdateOptions } from '../threads/overview/threadOverviewCacheHydration';
import { countsRoomRows } from './roomTimelineClassicRows';
import {
  ExpandAllLine,
  FilterBarSlot,
  listTopSentinelStyle,
  roomViewStyleUnder,
} from './RoomTimelineOverlays';
import {
  TimelineViewport,
  useTimelineDisplaySettings,
  useTimelineImageSlides,
  useTimelineScrollSetup,
  useTrustedRoomAccounts,
} from './TimelineViewport';
import { ThreadTimeline } from './ThreadTimeline';

export type RoomTimelineProps = {
  room: Room;
  eventId?: string;
  threadId?: string;
  /** Show a permalinked thread root in the room instead of opening its thread. */
  focusEventInRoom?: boolean;
  /** The router's key of the history entry whose address names `eventId`. */
  entryKey?: string;
  /** Whether the router pushed that entry (a link followed), not replaced or returned to it. */
  entryPushed?: boolean;
  /** Whether the app's Back put that entry in a thread's place (`RETURN_TO_ROOM_STATE`). */
  entryReturned?: boolean;
  summaryMap: ReadonlyMap<string, ThreadSummaryInfo>;
  onStoreThreadSummary: ThreadSummaryWriter;
  threadFilterState: ThreadFilterState;
  /** The filter bar's sort lock: the room's thread order as it was when the reader locked it. */
  threadSortFreezeState?: ThreadSortFreezeState | null;
  setThreadSortFreezeState?: Dispatch<SetStateAction<ThreadSortFreezeState | null>>;
  /** Without agents the filter bar keeps only its search and sort. */
  hasMindroomAgents?: boolean;
  /** The filter bar's controls; the room view keeps the state they change. */
  onSortDirectionChange?: () => void;
  onToggleThreadSortFreeze?: () => void;
  onToggleUnresolvedOnly?: () => void;
  onToggleForMe?: () => void;
  onTogglePerson?: (userId: string) => void;
  onClearPeople?: () => void;
  onReset?: () => void;
  onAddTag?: (tag: string) => void;
  onRemoveTag?: (tag: string) => void;
  onClearTags?: () => void;
  onSelectTab?: (tab: ThreadWorkflowTab) => void;
  onShowSnoozed?: () => void;
  onSearchQueryChange?: (query: string) => void;
  /** Compact shows its cards in sections (Needs you, Working, Later, Done). */
  threadSections?: boolean;
  /** The Compact filter bar's switch for `threadSections`. */
  onToggleThreadSections?: () => void;
  viewMode: RoomViewMode;
  compactRoomScrollStateRef?: MutableRefObject<ScrollAnchorMemory>;
  /** Where the room's rows were when a thread opened over them (`useThreadReturnPlace`). */
  threadReturnPlaceRef?: MutableRefObject<RoomRowsPlace | undefined>;
  editor: Editor;
  /** Called when the open thread's root cannot be loaded at all. */
  onThreadLoadError?: (threadId: string) => void;
  /** Shown above an open thread's rows, inside its scroll area. */
  threadHeader?: ReactNode;
  /** No room header above the thread: its header keeps a gap above it (`ThreadTimelineHeader`). */
  threadHeaderGapAbove?: boolean;
  /**
   * A fork draft's fork point: when it is one of the open thread's own messages, the thread shows
   * up to it, read-only as the fork will show it, with the "Forking" divider under it.
   */
  forkAt?: string;
  /** In a cross-room fork draft, the destination room that "Fork from here" and the divider target. */
  forkTargetRoom?: Room;
};

const EMPTY_EVENTS: MatrixEvent[] = [];
const EMPTY_IDS: ReadonlySet<string> = new Set();
const EMPTY_THREAD_SUMMARY_TIMELINE: ThreadSummaryTimelinePlan = {
  hiddenEventIds: EMPTY_IDS,
  markersByEventId: new Map(),
};
const EMPTY_SECRET_REQUEST_TIMELINE = { hiddenEventIds: EMPTY_IDS };
const NOOP_THREAD_ID_REF: MutableRefObject<string | undefined> = { current: undefined };
const NOOP_REFRESH_THREAD = async () => false;
/** Stand-ins for filter bar handlers a caller leaves out. */
const ignoreFilterChange = () => undefined;
const ignoreSortFreezeUpdate: Dispatch<SetStateAction<ThreadSortFreezeState | null>> = () =>
  undefined;
const getRoomRowContent = (event: MatrixEvent) =>
  getLatestMessageContent(event, getEditedEvent(event.getId() ?? '', event, undefined)) as Record<
    string,
    unknown
  >;

/**
 * The room's message list. Compact mode shows the room's threads as cards; the threaded and
 * Full (classic) views show the room timeline, the threaded one with a thread badge under each
 * thread root and the classic one with the replies inline; inside a thread, the root and its
 * replies. Rows are virtualized, and scroll anchoring keeps the reader's rows still when rows
 * land above them.
 */
export function RoomTimeline(props: RoomTimelineProps) {
  if (props.threadId) {
    return <ThreadTimeline {...props} threadId={props.threadId} />;
  }
  return <RoomTimelineGate {...props} />;
}

/**
 * A room list that mounts in Compact, as when a thread that filled the page closes, renders
 * nothing in its first pass: the overview's listeners start in that commit, and the list then
 * builds its cards once, from the room as they hear it, before the paint
 * (`useThreadOverviewListenedFirst`). Any other list builds in its first render, as it did.
 */
function RoomTimelineGate(props: RoomTimelineProps) {
  const listened = useThreadOverviewListenedFirst(
    props.room,
    undefined,
    props.viewMode === 'compact'
  );
  if (listened === 'waiting') return null;
  return <RoomTimelineRows {...props} listenedOverview={listened} />;
}

function RoomTimelineRows(props: RoomTimelineProps & { listenedOverview?: ThreadOverviewRefresh }) {
  const {
    room,
    eventId,
    focusEventInRoom,
    entryKey,
    entryPushed,
    entryReturned,
    summaryMap,
    onStoreThreadSummary,
    threadFilterState,
    threadSortFreezeState = null,
    setThreadSortFreezeState,
    hasMindroomAgents = true,
    viewMode,
    editor,
    forkTargetRoom,
  } = props;
  const crossRoomForkTarget =
    forkTargetRoom && forkTargetRoom.roomId !== room.roomId ? forkTargetRoom : undefined;
  const mx = useMatrixClient();
  const alive = useAlive();
  const engine = useSyncEngine();
  const { sessionId } = engine;
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
  const compactViewRequested = viewMode === 'compact';
  // Only the compact overview waits for the client's first catch-up, so only it follows sync.
  const clientCatchingUp = useInitialClientCatchup(compactViewRequested ? mx : undefined);
  const roomUnread = !!useRoomUnread(room.roomId, roomToUnreadAtom);
  const fallbackCompactScrollStateRef = useRef<ScrollAnchorMemory>(new Map());
  const compactRoomScrollStateRef =
    props.compactRoomScrollStateRef ?? fallbackCompactScrollStateRef;
  const fallbackThreadReturnPlaceRef = useRef<RoomRowsPlace>(undefined);

  // Without agents, the threaded view is the room's conversation in the order it was sent, like
  // the Full view: no filter bar, so no filter or sort of the bar applies there. The Compact
  // cards keep the bar (search and sort) in every room.
  const plainConversation = viewMode === 'threaded' && !hasMindroomAgents;
  const listedFilterState = useMemo(
    () => listedThreadFilterState(threadFilterState, props.threadSections === true),
    [props.threadSections, threadFilterState]
  );
  const {
    focusedRoomOverviewRequested,
    requestedThreadFilterState,
    showRoomThreadOverviewControls,
  } = resolveRoomTimelineViewState({
    eventId,
    focusEventInRoom,
    threadFilterState: plainConversation ? DIRECT_ROOM_TIMELINE_FILTER_STATE : listedFilterState,
    threadId: undefined,
    viewMode,
  });
  const [filterBarHeight, setFilterBarHeight] = useState<number | null>(null);
  const showThreadRepliesInRoom = viewMode === 'classic';
  const viewKey = `${room.roomId}|`;

  // Jump to Unread gives way while the "New messages" line it jumps to is in view.
  const [unreadMarker, setUnreadMarker] = useState<HTMLDivElement | null>(null);
  const roomIdRef = useLatestRef(room.roomId);
  const prefetchDepthRef = useLatestRef(prefetchDepth);
  // The room mounts its newest rows in a window of this size and widens it as the reader scrolls.
  const windowLimit = Math.min(prefetchDepth, ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE);
  const windowLimitRef = useLatestRef(windowLimit);
  const suppressFocusPaginationRef = useRef(false);
  const roomPaginatingBackRef = useRef(false);
  const [, forceRender] = useReducer((value: number) => value + 1, 0);

  const { roomDebugTraceId } = useTimelineDebugTraceIds({
    eventId,
    room,
    threadId: undefined,
  });

  // The room's loaded timeline and the window of it that is mounted.
  const filterOpts = useMemo<RecalibrateFilterOpts>(
    () => ({
      room,
      threadId: undefined,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      showThreadRepliesInRoom,
    }),
    [
      room,
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
  // The room's own rows: the render that shows another room starts from that room's timeline, so
  // no render pairs the room on screen with the rows of the room left (whose effects would page
  // one room's history into the other's timeline), and an update for the room left is dropped.
  const [timeline, setTimeline] = useViewScopedState<Timeline>(room.roomId, buildInitialTimeline);
  const [roomHasMoreCachedBack, setRoomHasMoreCachedBack] = useState(false);
  const [roomInitialCacheHydratedKey, setRoomInitialCacheHydratedKey] = useState<string>();
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useLatestRef(atBottom);
  const [focusItem, setFocusItem] = useState<RoomTimelineFocusItem>();
  const focusItemRef = useLatestRef(focusItem);
  const [unreadInfo, setUnreadInfo] = useRoomUnreadInfo(room, !!eventId);
  const readUptoEventIdRef = useLatestRef(unreadInfo?.readUptoEventId);

  const { overviewRefreshCounter, setOverviewRefreshCounter, overviewChanges } =
    useThreadOverviewRefreshCounter(room, undefined, props.listenedOverview);
  // The room's rows come from its timeline once more, so a deleted thread's root leaves the
  // overview, a frozen sort order included.
  const rederiveRoomRows = useCallback(
    () => setTimeline((current) => ({ ...current })),
    [setTimeline]
  );
  useRoomThreadDeleted(room, undefined, rederiveRoomRows);

  // Room rows: the room timeline's own, plus in the classic view the threads' replies.
  const { renderableEventEntries, renderableEvents, windowTimeline } = useRoomRowEntries({
    room,
    threadId: undefined,
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
    threadId: undefined,
    eventId,
    focusedRoomOverviewRequested,
    compactViewRequested,
    effectiveViewMode: viewMode,
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
    overviewChanges,
    sessionId,
    mx,
    onStoreThreadSummary,
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
    !compactViewRequested &&
    threadIndex.roomThreadFilterActive &&
    sortBy === 'lastReply' &&
    sortDirection === 'desc';
  const scroll = useTimelineScrollSetup({ latestAtTop });
  const {
    scrollRef,
    scrollElement,
    getScrollElement,
    footerProbeRef,
    contentRef,
    atBottomAnchorRef,
    scrollToBottomRef,
    latestAtTopRef,
  } = scroll;
  const unreadMarkerShown = useShownInScrollArea(unreadMarker, scrollElement);
  useThreadSortFreezeController({
    activeLiveOverviewThreadRootIds: threadIndex.activeLiveOverviewThreadRootIds,
    setThreadSortFreezeState: setThreadSortFreezeState ?? ignoreSortFreezeUpdate,
    threadId: undefined,
    threadSortControlSignature: threadIndex.threadSortControlSignature,
    threadSortFreezeState,
  });

  const windowState = useRoomTimelineWindowController({
    filteredRoomThreadActive: threadIndex.roomThreadFilterActive,
    filteredRoomOverviewOrderActive: threadIndex.roomOverviewOrderActive,
    overviewRefreshCounter,
    overviewThreadRootIds: threadIndex.overviewThreadRootIds,
    renderableEventEntries,
    renderableEvents,
    room,
    roomSurfaceEventEntries: threadIndex.roomSurfaceEventEntries,
    roomThreadListThreads: threadIndex.roomThreadListThreads,
    prefetchDepth: windowLimit,
    threadReplyCountMap: threadIndex.threadReplyCountMap,
    threadResolutionMap,
    timeline: windowTimeline,
    unreadInfo,
  });
  // The room's loaded rows and the window the timeline's state counts in them. The rows the
  // timeline lists and windows (`roomRows`, further down) hold each closed fold of membership
  // events as one row; what decides those folds reads the loaded rows.
  const loadedRoomRows = windowState.threadFilteredEvents;
  const loadedRoomRowEntries = windowState.threadFilteredEventEntries;
  const loadedRoomRowsRef = useLatestRef(loadedRoomRows);
  const stateRange = windowState.activeTimelineRange;
  const timelineRef = useLatestRef(timeline);
  const windowFollowsRowsRef = useLatestRef(!threadIndex.roomThreadFilterActive);
  const loadedWindowRows = useMemo(
    () => loadedRoomRows.slice(stateRange.start, stateRange.end),
    [loadedRoomRows, stateRange.end, stateRange.start]
  );
  // The classic view's mounted rows hold thread replies: reading the room reads their threads.
  const loadedWindowRowsRef = useLatestRef(loadedWindowRows);
  const classicRows = useMemo(
    () => (showThreadRepliesInRoom ? () => loadedWindowRowsRef.current : undefined),
    [loadedWindowRowsRef, showThreadRepliesInRoom]
  );

  const liveTimelineLinked = timeline.linkedTimelines.includes(getLiveTimeline(room));
  const firstRoomTimeline = timeline.linkedTimelines[0];
  const canPaginateRoomBack =
    typeof firstRoomTimeline?.getPaginationToken(Direction.Backward) === 'string';
  const firstRoomTimelineRef = useLatestRef(firstRoomTimeline);
  const lastRoomTimeline = timeline.linkedTimelines[timeline.linkedTimelines.length - 1];
  const lastRoomTimelineRef = useLatestRef(lastRoomTimeline);
  const canPaginateRoomFront =
    typeof lastRoomTimeline?.getPaginationToken(Direction.Forward) === 'string';

  const priorityTargets = windowState.priorityThreadSeedPrewarmRoots;
  useThreadSeedPrewarmController({
    room,
    mx,
    sessionId,
    prefetchDepthRef,
    activeThreadId: undefined,
    priorityTargets,
    debugTraceId: roomDebugTraceId,
  });
  const beginThreadCacheWrite = useCallback(
    () => engine.persist.forRoom(room).persistThreadEventCache,
    [engine, room]
  );
  const beginRoomCacheWrite = useCallback(
    () => engine.persist.forRoom(room).persistRoomEventCache,
    [engine, room]
  );

  const readerScrolledRef = useViewScopedFlag(viewKey);

  const feature = useTimelineMessageFeature({
    room,
    forkTargetRoom: crossRoomForkTarget,
    editor,
    threadId: undefined,
    scrollRef,
    showThreadRepliesInRoom,
    messageLayout,
    messageSpacing,
    hideActivity,
  });

  const revealedIdsRef = useRef(new Set<string>());
  const focusEventId = focusItem?.eventId;
  if (eventId) revealedIdsRef.current.add(eventId);
  if (focusEventId) revealedIdsRef.current.add(focusEventId);

  const rowTimelineSet = room.getUnfilteredTimelineSet();
  const getImageSlides = useTimelineImageSlides({
    mx,
    room,
    events: loadedRoomRows,
    rowTimelineSet,
    ignoredUsersSet,
  });
  const approvalTimeline = useThreadApprovalTimeline(
    loadedRoomRows,
    ignoredUsersSet,
    undefined,
    eventId,
    focusEventId
  );
  const { trustedAccountIds, viewerId, canCompose } = useTrustedRoomAccounts(room, ignoredUsersSet);
  // Paired among the rows the window draws: an echo hides only beside its drawn voice message.
  const voiceTranscripts = useVoiceTranscriptPlan({
    events: loadedWindowRows,
    getContent: getRoomRowContent,
    trustedAccountIds,
    ignored: ignoredUsersSet,
    revealed: revealedIdsRef.current,
    viewerId,
    expectsAnswer: () =>
      room
        .getJoinedMembers()
        .some(({ userId }) => isMindroomResponderForViewer(userId, viewerId, trustedAccountIds)),
    hasThreadReplies: (event) => {
      const id = event.getId();
      return (
        (getKnownThreadReplyCount(event) ?? 0) > 0 ||
        (!!id &&
          ((threadIndex.threadReplyCountMap.get(id) ?? 0) > 0 ||
            (room.getThread(id)?.length ?? 0) > 0))
      );
    },
  });
  const isHiddenBeforeFolding = useCallback(
    (event: MatrixEvent) =>
      isTimelineRowHidden(event, {
        messageData: {
          approvalTimeline,
          voiceTranscripts,
          replyCards: NO_REPLY_CARDS,
          modelChanges: NO_MODEL_CHANGES,
        },
        ignoredUsersSet,
        showHiddenEvents,
      }),
    [approvalTimeline, voiceTranscripts, ignoredUsersSet, showHiddenEvents]
  );

  // While the opening room view does not fill the screen, keep paginating. The fill holds the
  // last row still while the rows above it measure, so a view whose newest row is its first
  // (which loads older history at its bottom sentinel) does without it.
  const roomSurfaceShown = !compactViewRequested;
  const threadReturnPlace = useThreadReturnPlace({
    memoryRef: props.threadReturnPlaceRef ?? fallbackThreadReturnPlaceRef,
    roomId: room.roomId,
    threadId: undefined,
    eventId,
    roomRowsShown: roomSurfaceShown,
    latestAtTop,
    scrollRef,
  });
  // Consecutive room membership events fold behind a centered divider pill. A run with a row the
  // route or a jump opened, or the row a thread's way back returns to, stays unfolded from then
  // on, so the row is among the room's rows.
  const membershipRevealedRef = useRef(new Set<string>());
  const returnEventId = threadReturnPlace?.eventId;
  const membershipPinnedIds = useMemo(() => {
    [eventId, focusEventId, returnEventId].forEach((id) => {
      if (id) membershipRevealedRef.current.add(id);
    });
    return membershipRevealedRef.current.size === 0
      ? EMPTY_IDS
      : new Set(membershipRevealedRef.current);
  }, [eventId, focusEventId, returnEventId]);
  const membershipFolds = useMembershipFolds({
    mx,
    roomId: room.roomId,
    enabled: true,
    events: loadedRoomRows,
    entries: loadedRoomRowEntries,
    isSkipped: isHiddenBeforeFolding,
    pinnedIds: membershipPinnedIds,
  });
  const membershipFoldsRef = useLatestRef(membershipFolds.view);
  const renderedRoomRowsRef = useRef<RenderedRoomRows>(NO_RENDERED_ROOM_ROWS);
  // Before the list lays out this render's rows: a fold that formed over rows it holds starts at
  // their height, whatever the list measured for the row of its first event.
  forgetFormedFoldHeights(renderedRoomRowsRef.current, membershipFolds.view);
  // The room's rows: the loaded rows with each closed fold as one row. The window, the virtual
  // list, the paginator and every jump count in these; the state's window counts loaded rows.
  const roomProjection = membershipFolds.rows;
  const roomProjectionRef = useLatestRef(roomProjection);
  const roomRows = roomProjection.rows;
  const roomRowEntries = roomProjection.entries;
  const roomRowsRef = useLatestRef(roomRows);
  const { rowRange: activeTimelineRange, loadedRange } = useRoomRowWindow(
    roomProjection,
    stateRange
  );
  const activeRangeRef = useLatestRef(activeTimelineRange);
  const loadedRangeRef = useLatestRef(loadedRange);
  const loadedRangeOfRef = useRef((rowRange: Timeline['range']) =>
    loadedRangeOfRows(roomProjectionRef.current, rowRange)
  );
  const roomWindowRows = useMemo(
    () => roomRows.slice(activeTimelineRange.start, activeTimelineRange.end),
    [activeTimelineRange.end, activeTimelineRange.start, roomRows]
  );
  useWindowHoldsWholeFolds({
    timeline,
    roomWindow: !threadIndex.roomThreadFilterActive,
    stateRange,
    loadedRange,
    setTimeline,
  });
  useWindowKeepsNewestRow({
    activeTimelineRange: loadedRange,
    eventId,
    roomRowCount: loadedRoomRows.length,
    threadId: undefined,
    setTimeline,
  });
  const timelineAtLiveEnd = isTimelineAtLiveEnd({
    threadId: undefined,
    liveTimelineLinked,
    rangeAtEnd: activeTimelineRange.end >= roomRows.length,
    canPaginateThreadFront: false,
    threadTailLoaded: false,
  });
  const atLiveEndRef = useLatestRef(timelineAtLiveEnd);

  const automaticFill = useRoomAutomaticFill({
    viewKey,
    enabled: roomSurfaceShown && !eventId && !latestAtTop,
    latestEventId: loadedRoomRows[loadedRoomRows.length - 1]?.getId(),
    contentKey: `${loadedRange.start}:${loadedRange.end}:${loadedRoomRows.length}`,
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
    threadId: undefined,
    threadIdRef: NOOP_THREAD_ID_REF,
    timeline,
  });
  const showRoomIntro =
    liveTimelineLinked &&
    activeTimelineRange.start === 0 &&
    !canPaginateRoomBack &&
    !roomHasMoreCachedBack;
  const hasRoomLeadingIntro = showRoomIntro && !latestAtTop;
  // Oldest-first rooms always keep one leading item 0 with one stable key (`[+all]` alone, or
  // `{roomIntro}{expandAllToggle}` once start loads) so mounting the intro grows item 0 in place.
  const hasRoomLeadingTile = !latestAtTop && (hasRoomLeadingIntro || roomWindowRows.length > 0);
  const roomLeadingOffset = hasRoomLeadingTile ? 1 : 0;
  const roomLeadingOffsetRef = useLatestRef(roomLeadingOffset);
  // The virtual list and its scroll anchoring.
  const itemCount = roomWindowRows.length + roomLeadingOffset;
  const showRoomBackSentinel =
    activeTimelineRange.start > 0 || canPaginateRoomBack || roomHasMoreCachedBack;
  const showRoomFrontSentinel = activeTimelineRange.end < roomRows.length || canPaginateRoomFront;
  const { estimateSize, getItemKey } = timelineRowSizing({
    compactLayout,
    showThreadRepliesInRoom,
    hasRoomIntro: hasRoomLeadingTile,
    roomWindowRows,
    windowStart: activeTimelineRange.start,
    roomRowsRef,
    activeRangeRef,
    threadRecordMapRef,
    membershipFoldsRef,
    renderedRoomRowsRef,
    // Fixed per form factor so splitter drags do not re-estimate unmeasured rows above the reader.
    columnWidth: phone ? undefined : 960,
  });
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
    anchorRoomRows: latestAtTop && !latestPinAsked ? anchorBelowLatestEnd : undefined,
    estimateSize,
    getItemKey,
    getScrollElement,
    itemCount,
    latestAtTop,
    roomId: room.roomId,
    threadId: undefined,
    pinThreadLeadingItem: false,
    anchorSkipLeading: roomLeadingOffset,
    canLoadOlder: !latestAtTop && showRoomBackSentinel,
    automaticFill: roomSurfaceShown ? { geometryReader: automaticFill.geometryReader } : undefined,
  });
  const { virtualizer } = ledger;
  const virtualizerRef = useLatestRef(virtualizer);
  const {
    virtualItems,
    listHeight,
    listHeightHeld,
    heldEndSpacer,
    holdOffset,
    pendingListShrinkPx,
  } = useHeldRowsLayout({
    ledger,
    itemCount,
    contentRef,
    latestAtTop,
    startAligned: compactCards,
    forceRender,
  });
  useMembershipFoldRowSizes(
    virtualizer,
    roomWindowRows,
    membershipFolds.view,
    renderedRoomRowsRef,
    roomLeadingOffset
  );

  // After useTimelineScrollLedgerController so virtual-core's _willUpdate() applies anchorTo: 'end'
  // scrollTop shifts in useLayoutEffect before useVirtualPaginator checks backSentinel visibility
  // and trims rows below view.
  const { paginator, settledRoomPage, getRoomRowElement } = useRoomWindowPaginator({
    alive,
    roomRows,
    roomRowsRef,
    activeTimelineRange,
    activeRangeRef,
    loadedRangeOfRef,
    firstRoomTimelineRef,
    lastRoomTimelineRef,
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

  // Jumps: the paginator scrolls to mounted rows and moves the window; the virtual list
  // scrolls to the rows of the window it has not mounted.
  const {
    scrollToItem: paginatorScrollToItem,
    scrollToElement: paginatorScrollToElement,
    retryPagination,
  } = paginator;
  useRetryAfterPageWithoutRows(settledRoomPage, roomRowsRef, retryPagination);
  const { scrollToItem, scrollToElement } = useTimelineRowJumps({
    paginatorScrollToItem,
    paginatorScrollToElement,
    activeRangeRef,
    virtualizerRef,
    roomLeadingOffsetRef,
    rows: { getScrollElement, getRowElement: getRoomRowElement, roomRowsRef },
  });
  const gesturePins = useGestureBottomPins({
    scrollToBottomRef,
    readerScrolledRef,
    onFirstGesture: forceRender,
  });
  const clearHoldOffset = useCallback(
    () => clearVirtualizerHoldOffset(virtualizerRef.current),
    [virtualizerRef]
  );

  const effectiveThreadFilterStateRef = useLatestRef(threadIndex.effectiveThreadFilterState);
  const { handleOpenEvent, openRoomEventRoute } = useRoomEventOpenController({
    alive,
    effectiveViewMode: viewMode,
    focusEventInRoom,
    hideMembershipEvents,
    hideNickAvatarEvents,
    ignoredUsersSet,
    mx,
    navigateRoomThread,
    overviewThreadRootIds: threadIndex.overviewThreadRootIds,
    readUptoEventIdRef,
    recalibrateFilterOptsRef: filterOptsRef,
    room,
    roomOverviewOrderActive: threadIndex.roomOverviewOrderActive,
    roomThreadListThreads: threadIndex.roomThreadListThreads,
    prefetchDepth: windowLimit,
    prefetchDepthRef: windowLimitRef,
    scheduledStatusMap: threadIndex.scheduledStatusMap,
    scrollRef,
    scrollToBottomRef,
    scrollToElement,
    scrollToItem,
    searchQuery: threadIndex.searchQuery,
    setFocusItem,
    setTimeline,
    showHiddenEvents,
    threadFilteredEvents: roomRows,
    foldedRows: roomProjection.foldedRows,
    threadFilterStateRef: effectiveThreadFilterStateRef,
    threadParticipantMap: threadIndex.threadParticipantMap,
    threadReplyCountMap: threadIndex.threadReplyCountMap,
    threadResolutionMap,
    threadSortControlSignature: threadIndex.threadSortControlSignature,
    threadSortFreezeState,
    threadSummaryInfoMap: threadIndex.threadSummaryInfoMap,
  });
  useRoomEventRouteOpenController({
    effectiveViewMode: viewMode,
    entryReturned,
    eventId,
    focusEventInRoom,
    openRoomEventRoute,
    roomId: room.roomId,
    roomOverviewOrderActive: threadIndex.roomOverviewOrderActive,
  });

  useRoomFocusScrollController({
    readMeasurementCorrectionPx: ledger.readMeasurementCorrectionPx,
    alive,
    atBottomAnchorRef,
    editId: feature.editingEventId,
    focusItem,
    focusScrollResetToken: room.roomId,
    latestAtTopRef,
    retryPagination,
    roomId: room.roomId,
    scrollRef,
    onBottomPin: clearHoldOffset,
    scrollToBottomRef,
    scrollToElement,
    scrollToItem,
    setAtBottom,
    setFocusItem,
    suppressFocusPaginationRef,
    shouldApplyThreadBottomPin: gesturePins.shouldApplyBottomPin,
    threadFilteredEvents: roomRows,
    threadFilteredEventsRef: roomRowsRef,
    foldedRows: roomProjection.foldedRows,
    timelineAtLiveEnd,
    unreadInfo,
    // The row of the read marker, or the closed fold that holds it.
    unreadScrollAnchorIndex:
      windowState.unreadScrollAnchorIndex === undefined
        ? undefined
        : rowIndexOfLoaded(roomProjection, windowState.unreadScrollAnchorIndex),
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
    readUptoEventId: unreadInfo?.readUptoEventId,
  });
  // Jump to Latest also ends the jump to a linked message: until its row rests, that jump scrolls
  // back to it whenever the row or the scroll area resizes, as the latest rows do when they render.
  const handleJumpToLatest = useCallback(() => {
    setFocusItem(undefined);
    showLatestRows();
  }, [showLatestRows]);
  // The reader's tap on Jump to Latest first stops a flick that still scrolls the rows.
  const stopFlick = useFlickStop(getScrollElement);
  const handleJumpToLatestTap = useCallback(() => {
    stopFlick();
    handleJumpToLatest();
  }, [handleJumpToLatest, stopFlick]);

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
  }, [atLiveEndRef, compactViewRequested, handleJumpToLatest, scrollToBottomRef]);

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
    timelineAtLiveEnd,
    unreadInfo,
  });

  const markRoomAsRead = useMarkRoomAsRead(handleMarkAsRead, setUnreadInfo, undefined);

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
    threadId: undefined,
    threadIdRef: NOOP_THREAD_ID_REF,
  });
  useRoomCachedBackState({
    alive,
    eventId,
    eventsLength: renderableEvents.length,
    room,
    roomDebugTraceId,
    roomIdRef,
    sessionId,
    setRoomHasMoreCachedBack,
    setTimeline,
    threadId: undefined,
    threadIdRef: NOOP_THREAD_ID_REF,
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
    threadId: undefined,
    eventId,
    timeline,
    rebuildTimeline: buildInitialTimeline,
    setTimeline: setRelinkedTimeline,
    isViewportAtBottomNow: isViewportAtLatestNow,
    scrollToBottomRef,
  });
  const handleRoomRefresh = useCallback(
    () => setTimeline(buildInitialTimeline()),
    [buildInitialTimeline, setTimeline]
  );
  useThreadAwareTimelineRefresh({
    room,
    threadId: undefined,
    liveTimelineLinked,
    refreshLatestThreadSlice: NOOP_REFRESH_THREAD,
    onRoomRefresh: handleRoomRefresh,
  });
  useThreadSummaryPublishController({
    onStoreThreadSummary,
    room,
    thread: null,
    threadEvents: EMPTY_EVENTS,
    threadId: undefined,
    threadSummaryInfoMap: threadIndex.threadSummaryInfoMap,
  });
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
    fetchMissing: peopleInUse,
    onApplyThreadRelations: applyThreadRelations,
    onStoreThreadSummary,
    beginThreadCacheWrite,
  });
  useThreadOverviewResumeController({
    alive,
    activeTimelineRange: loadedRange,
    compactFilteredThreadRootIds: threadIndex.compactFilteredThreadRootIds,
    compactViewRequested,
    debugTraceId: roomDebugTraceId,
    filteredThreadRootIds: threadIndex.filteredThreadRootIds,
    limit: windowLimit,
    mx,
    onStoreThreadSummary,
    onApplyThreadRelations: applyThreadRelations,
    beginThreadCacheWrite,
    refreshCompactThreadList: threadIndex.refreshRoomThreadList,
    room,
    sessionId,
    setOverviewRefreshCounter,
    showCompactRoomView: threadIndex.showCompactRoomView,
    threadFilteredEventEntries: loadedRoomRowEntries,
    threadId: undefined,
    threadIdRef: NOOP_THREAD_ID_REF,
    threadReplyCountMap: threadIndex.threadReplyCountMap,
    threadResolutionMap,
  });

  useRoomRowRemoval({
    room,
    timelineRef,
    roomRowsRef: loadedRoomRowsRef,
    activeRangeRef: loadedRangeRef,
    windowFollowsRowsRef,
    paginatingBackRef: roomPaginatingBackRef,
    threadIdRef: NOOP_THREAD_ID_REF,
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
    setTimeline,
    setUnreadInfo,
    showHiddenEvents,
    classicRows,
    threadResolutionMap,
    timelineAtLiveEnd,
    unreadInfo,
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
  // After every other timeline observer so its passive ResizeObserver runs last.
  useTimelineLiveEnd({
    surface: roomSurfaceShown ? 'room' : undefined,
    itemCount,
    virtualizer,
    listHeightHeld,
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
    committedView: `${viewKey}|${viewMode}`,
    focusItem,
    onReaderGesture: gesturePins.onRoomGesture,
    pendingListShrinkPx,
    contentRef,
    footerProbeRef,
    isViewportAtBottomNow,
    atLiveEndRef,
    liveReplies: getLiveReplyStore(mx),
  });
  // The header's filter button hides the bar; the filters keep applying while it is hidden.
  const filterBarShown =
    showRoomThreadOverviewControls && !plainConversation && !hideThreadFilterBar;
  // Agent rooms' cards can show in sections; the bar hides the sort only while they do.
  const sectionsOffered = compactCards && hasMindroomAgents;
  const threadSectionsShown = sectionsOffered && props.threadSections === true;
  const filterBar = filterBarShown && (
    <FilterBarSlot onHeight={setFilterBarHeight}>
      <RoomThreadOverview
        roomId={room.roomId}
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
        bucketCounts={threadIndex.bucketCounts}
        countsSettled={threadIndex.threadListSettled}
        onSelectTab={props.onSelectTab ?? ignoreFilterChange}
        tagCounts={threadIndex.tagCounts}
        state={threadFilterState}
        availableTags={threadIndex.availableRoomTags}
        isThreadSortFrozen={!!threadSortFreezeState}
        onSortDirectionChange={props.onSortDirectionChange ?? ignoreFilterChange}
        onToggleThreadSortFreeze={props.onToggleThreadSortFreeze ?? ignoreFilterChange}
        onToggleUnresolvedOnly={props.onToggleUnresolvedOnly ?? ignoreFilterChange}
        onToggleForMe={props.onToggleForMe}
        onReset={props.onReset ?? ignoreFilterChange}
        onAddTag={props.onAddTag ?? ignoreFilterChange}
        onRemoveTag={props.onRemoveTag ?? ignoreFilterChange}
        onClearTags={props.onClearTags ?? ignoreFilterChange}
        onSearchQueryChange={props.onSearchQueryChange ?? ignoreFilterChange}
        threadSections={threadSectionsShown}
        onToggleThreadSections={sectionsOffered ? props.onToggleThreadSections : undefined}
        hideEmptyState={compactCards && threadIndex.showCompactRoomView}
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
  const hydrating = roomInitialCacheHydratedKey !== room.roomId || clientCatchingUp;
  const noThreadYet = compactCards && !threadIndex.showCompactRoomView && hydrating;
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
    const focusRequest =
      eventId && focusEventInRoom
        ? { eventId, entryKey, pushed: entryPushed, returned: entryReturned }
        : undefined;
    if (focusRequest) {
      takeCompactFocusRequest(compactRoomScrollStateRef.current, room.roomId, focusRequest);
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
          focusRequest={focusRequest}
          // The timeline cache read is skipped for an event address.
          indexPending={(eventId ? clientCatchingUp : hydrating) || threadIndex.threadListLoading}
          focusScope={threadIndex.threadSortControlSignature}
          filterBarShown={filterBarShown}
          // The clock the list was filtered at, so the sections show what the selected tab does.
          sectionsNow={threadSectionsShown ? threadIndex.snoozeNow : undefined}
          singleBucketTab={
            threadSectionsShown && threadFilterState.tab && threadFilterState.tab !== 'all'
              ? threadFilterState.tab
              : undefined
          }
          emptyState={{
            filterState: threadFilterState,
            now: threadIndex.snoozeNow,
            canCompose,
            onReset: props.onReset ?? ignoreFilterChange,
            onToggleForMe: props.onToggleForMe,
            onShowSnoozed: props.onShowSnoozed ?? props.onReset ?? ignoreFilterChange,
          }}
        />
      </Box>
    );
  }

  const messageData: TimelineMessageData = {
    threadRecordMap: threadIndex.threadRecordMap,
    approvalTimeline,
    threadSummaryTimeline: EMPTY_THREAD_SUMMARY_TIMELINE,
    secretRequestTimeline: EMPTY_SECRET_REQUEST_TIMELINE,
    voiceTranscripts,
    replyCards: NO_REPLY_CARDS,
    modelChanges: NO_MODEL_CHANGES,
    handleOpenReply,
  };
  // Nothing to jump to without the line; the newest-first view opens at the unread rows anyway.
  const showJumpToUnread =
    !latestAtTop &&
    offersJumpToUnread({
      threadId: undefined,
      unreadInfo,
      roomUnread,
      unreadMarkerShown,
    });
  // In the room the toggle takes a line of its own above the rows; a thread has none. A phone's
  // unread pills, as wide as the line nearly, sit at its height: while they show, the toggle moves
  // to the line's start and they keep clear of it there.
  const expandAllToggle = roomWindowRows.length > 0 && (
    <ExpandAllLine
      expanded={expandAll}
      onToggle={handleToggleExpandAll}
      atStart={phone && showJumpToUnread}
    />
  );
  const roomIntro =
    showRoomIntro &&
    (compactCards ? <CompactRoomWithoutThreads room={room} /> : <RoomIntro room={room} />);
  const tiles = renderTimelineTiles({
    virtualItems,
    roomIntroNode: hasRoomLeadingTile ? (
      <>
        {hasRoomLeadingIntro && roomIntro}
        {expandAllToggle}
      </>
    ) : undefined,
    roomWindowRows,
    roomRowEntries,
    windowStart: activeTimelineRange.start,
    // With the newest row first, the line would mark the newest row rather than where the reader
    // stopped; that view draws none (as MindRoom Chat), and reading at its top reads the room.
    readUptoAbsoluteIndex: latestAtTop ? undefined : windowState.readUptoAbsoluteIndex,
    ignoredUsersSet,
    showHiddenEvents,
    timelineSet: rowTimelineSet,
    focusItem,
    messageData,
    renderEvent: feature.renderEvent,
    isQuietMarkerRow: feature.isQuietMarkerRow,
    joinsQuietMarkerRun: feature.joinsQuietMarkerRun,
    membershipFolds,
    unreadMarkerRef: setUnreadMarker,
    measureElement: ledger.measureElement,
  });
  // The room's start (its intro and the sentinel that loads older history) and newer history
  // (the front sentinel) sit at the ends where their rows are: with the newest row first, older
  // history is at the bottom. The sentinel above the rows sits inside the list at item 0's top
  // (-_holdOffset while virtual-core holds a prepend), so held rows above the reader count as loaded.
  const backHeadroomPx =
    !latestAtTop && readerScrolledRef.current.value
      ? (virtualizer.measurementsCache[
          Math.min(THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS, itemCount - 1)
        ]?.start ?? 0)
      : 0;
  const topSentinelStyle =
    holdOffset !== 0 || backHeadroomPx > 1
      ? {
          ...listTopSentinelStyle,
          ...(holdOffset !== 0 ? { insetBlockStart: -holdOffset } : undefined),
          ...(backHeadroomPx > 1 ? { height: backHeadroomPx } : undefined),
        }
      : listTopSentinelStyle;
  const backSentinel = showRoomBackSentinel && (
    <div ref={paginator.observeBackAnchor} style={latestAtTop ? { height: 1 } : topSentinelStyle} />
  );
  const frontSentinel = showRoomFrontSentinel && (
    <div
      ref={paginator.observeFrontAnchor}
      style={latestAtTop ? listTopSentinelStyle : { height: 1 }}
    />
  );

  return (
    <TimelineViewport
      containerStyle={roomStyle}
      justifyContent={compactCards || latestAtTop ? 'Start' : 'End'}
      latestAtTop={latestAtTop}
      filterBar={filterBar}
      unreadActions={
        showJumpToUnread && (
          <UnreadActions
            onJumpToUnread={handleJumpToUnread}
            onMarkAsRead={markRoomAsRead}
            clearStart={phone}
          />
        )
      }
      contentTop={latestAtTop && expandAllToggle}
      contentBottom={
        latestAtTop ? (
          <>
            {roomIntro}
            {backSentinel}
          </>
        ) : (
          frontSentinel
        )
      }
      topSentinel={latestAtTop ? frontSentinel : backSentinel}
      tiles={tiles}
      scroll={scroll}
      virtualInnerRef={ledger.virtualInnerRef}
      listHeight={listHeight}
      heldEndSpacer={heldEndSpacer}
      hideRows={automaticFill.hideInitialRows}
      virtualInnerTestId="room-virtual-inner"
      getImageSlides={getImageSlides}
      wrapExpansion={feature.wrapExpansion}
      atBottom={atBottom}
      onJumpToLatest={handleJumpToLatestTap}
      forkToRoomDialog={feature.forkToRoomDialog}
    />
  );
}
