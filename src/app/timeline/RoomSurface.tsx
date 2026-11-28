import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { Direction } from 'matrix-js-sdk';
import { Box, Spinner } from 'folds';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { usePanePaused } from '../lib/hooks/usePaneCollapsed';
import { useInitialClientCatchup } from '../matrix/hooks/useInitialClientCatchup';
import type { ThreadSortFreezeState } from '../event-store/threads/roomThreadOverviewModel';
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
import type { RoomTimelineFocusItem, ScrollToBottomState } from './roomFocusScrollController';
import {
  useRoomEventOpenController,
  useRoomEventRouteOpenController,
} from './roomEventOpenController';
import { useThreadAwareTimelineRefresh } from './useThreadAwareTimelineRefresh';
import { useCompactCoverageBackfillController } from '../threads/overview/compactCoverageBackfillController';
import { useCompactRootEditBackfillController } from '../threads/overview/compactRootEditBackfillController';
import { useThreadOverviewResumeController } from '../threads/overview/threadOverviewResumeController';
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
import { ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE } from '../event-store/cache/preloadSettings';
import { useViewScopedState } from './roomTimelineViewScope';
import type { ScrollToElement, ScrollToItem } from './useVirtualPaginator';
import {
  useRelinkKeepingRows,
  useRoomRowRemoval,
  useRoomThreadDeleted,
} from './roomTimelinePaginationWindow';
import { useRoomUnreadInfo } from './roomTimelineUnread';
import { useRoomRowEntries } from './roomTimelineRows';
import { collectThreadWriterIds, recordThreadWriters } from '../event-store/threads/threadWriters';
import { useThreadWritersBackfill } from '../threads/overview/useThreadWritersBackfill';
import type { FetchedRelationOverviewUpdateOptions } from '../threads/overview/threadOverviewCacheHydration';
import { countsRoomRows } from './roomTimelineClassicRows';
import { FilterBarSlot, roomViewStyleUnder } from './RoomTimelineOverlays';
import { useTimelineEnvironment, useTrustedRoomAccounts } from './TimelineViewport';
import { useTimelineExpansionState } from './message-rendering/useTimelineMessageFeature';
import {
  useThreadReturnPlace,
  useViewportAtBottomNow,
  type RoomRowsPlace,
} from './roomTimelineScroll';
import type { TimelineLiveEndViewState } from './timelineLiveEnd';
import { CompactRoomSurface } from './CompactRoomSurface';
import { RoomRowsTimeline } from './RoomRowsTimeline';
import type { RoomTimelineProps } from './RoomTimeline';

const NOOP = () => undefined;
const EMPTY_PREWARM_TARGETS: Array<{ threadId: string }> = [];
const EMPTY_THREAD_RECORD_MAP: ReadonlyMap<string, never> = new Map<string, never>();
const NOOP_THREAD_ID_REF: MutableRefObject<string | undefined> = { current: undefined };
const ignoreSortFreeze: Dispatch<SetStateAction<ThreadSortFreezeState | null>> = NOOP;

type RoomRowsViewportApi = {
  scrollToItem: ScrollToItem;
  scrollToElement: ScrollToElement;
  followOwnSend: () => void;
};

function useRoomSurfaceState(props: RoomTimelineProps, listenedOverview?: ThreadOverviewRefresh) {
  const { room, eventId, threadFilterState, viewMode, uncommittedBackPeek = false } = props;
  const threadSortFreezeState = props.threadSortFreezeState ?? null;
  const hasMindroomAgents = props.hasMindroomAgents ?? true;
  const paused = usePanePaused();
  const env = useTimelineEnvironment();
  const { mx, alive, engine, sessionId, settings, filters } = env;
  const compactViewRequested = viewMode === 'compact';
  const clientCatchingUp = useInitialClientCatchup(compactViewRequested ? mx : undefined);
  const plainConversation = viewMode === 'threaded' && !hasMindroomAgents;
  const listedFilterState = useMemo(
    () => listedThreadFilterState(threadFilterState, props.threadSections === true),
    [props.threadSections, threadFilterState]
  );
  const viewState = resolveRoomTimelineViewState({
    eventId,
    focusEventInRoom: props.focusEventInRoom,
    threadFilterState: plainConversation ? DIRECT_ROOM_TIMELINE_FILTER_STATE : listedFilterState,
    threadId: undefined,
    viewMode,
  });
  const [filterBarHeight, setFilterBarHeight] = useState<number | null>(null);
  const showThreadRepliesInRoom = viewMode === 'classic';
  const roomIdRef = useLatestRef(room.roomId);
  const prefetchDepthRef = useLatestRef(settings.prefetchDepth);
  const windowLimit = Math.min(settings.prefetchDepth, ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE);
  const windowLimitRef = useLatestRef(windowLimit);
  const roomPaginatingBackRef = useRef(false);
  const { roomDebugTraceId } = useTimelineDebugTraceIds({ eventId, room });

  const filterOpts = useMemo<RecalibrateFilterOpts>(
    () => ({ room, threadId: undefined, ...filters, showThreadRepliesInRoom }),
    [room, filters, showThreadRepliesInRoom]
  );
  const filterOptsRef = useLatestRef(filterOpts);
  const buildInitialTimeline = useCallback((): Timeline => {
    const { room: filterRoom, ...opts } = filterOptsRef.current;
    return countsRoomRows(getInitialTimeline(filterRoom, windowLimitRef.current, opts));
  }, [filterOptsRef, windowLimitRef]);

  const [timeline, setTimeline] = useViewScopedState<Timeline>(room.roomId, buildInitialTimeline);
  const [roomHasMoreCachedBack, setRoomHasMoreCachedBack] = useState(false);
  const [roomInitialCacheHydratedKey, setRoomInitialCacheHydratedKey] = useState<string>();
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useLatestRef(atBottom);
  const [focusItem, setFocusItem] = useState<RoomTimelineFocusItem>();
  const focusItemRef = useLatestRef(focusItem);
  const scrollToBottomRef = useRef<ScrollToBottomState>({ count: 0, smooth: false });
  const [unreadInfo, setUnreadInfo] = useRoomUnreadInfo(room, !!eventId);
  const readUptoEventIdRef = useLatestRef(unreadInfo?.readUptoEventId);

  const { overviewRefreshCounter, setOverviewRefreshCounter, overviewChanges } =
    useThreadOverviewRefreshCounter(room, undefined, listenedOverview);
  const rederiveRoomRows = useCallback(() => setTimeline((c) => ({ ...c })), [setTimeline]);
  useRoomThreadDeleted(room, rederiveRoomRows);

  const { renderableEventEntries, renderableEvents, windowTimeline } = useRoomRowEntries({
    ...filters,
    room,
    timeline,
    setTimeline,
    showThreadRepliesInRoom,
  });
  const threadResolutionMap = useRoomThreadResolutionMap(room);
  const threadIndex = useThreadIndex({
    ...filters,
    room,
    uncommittedBackPeek,
    threadId: undefined,
    eventId,
    focusEventInRoom: props.focusEventInRoom,
    focusedRoomOverviewRequested: viewState.focusedRoomOverviewRequested,
    compactViewRequested,
    effectiveViewMode: viewMode,
    linkedTimelines: timeline.linkedTimelines,
    renderableEventEntries,
    summaryMap: props.summaryMap,
    threadResolutionMap,
    currentUserId: mx.getUserId() ?? undefined,
    requestedThreadFilterState: viewState.requestedThreadFilterState,
    threadSortFreezeState,
    overviewRefreshCounter,
    overviewChanges,
    sessionId,
    mx,
    onStoreThreadSummary: props.onStoreThreadSummary,
  });
  const compactCards = compactViewRequested && !threadIndex.focusedRoomOverviewBypass;
  const { sortBy, sortDirection } = threadIndex.effectiveThreadFilterState;
  const latestAtTop =
    !compactViewRequested &&
    threadIndex.roomThreadFilterActive &&
    sortBy === 'lastReply' &&
    sortDirection === 'desc';
  const latestAtTopRef = useLatestRef(latestAtTop);

  useThreadSortFreezeController({
    activeLiveOverviewThreadRootIds: threadIndex.activeLiveOverviewThreadRootIds,
    setThreadSortFreezeState: props.setThreadSortFreezeState ?? ignoreSortFreeze,
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
  const { threadFilteredEvents: loadedRoomRows, activeTimelineRange: stateRange } = windowState;
  const loadedRoomRowsRef = useLatestRef(loadedRoomRows);
  const timelineRef = useLatestRef(timeline);
  const windowFollowsRowsRef = useLatestRef(!threadIndex.roomThreadFilterActive);
  const loadedWindowRows = useMemo(
    () => loadedRoomRows.slice(stateRange.start, stateRange.end),
    [loadedRoomRows, stateRange.end, stateRange.start]
  );
  const loadedWindowRowsRef = useLatestRef(loadedWindowRows);
  const classicRows = useMemo(
    () => (showThreadRepliesInRoom ? () => loadedWindowRowsRef.current : undefined),
    [loadedWindowRowsRef, showThreadRepliesInRoom]
  );

  const liveTimelineLinked = timeline.linkedTimelines.includes(getLiveTimeline(room));
  const firstRoomTimeline = timeline.linkedTimelines[0];
  const canPaginateRoomBack =
    typeof firstRoomTimeline?.getPaginationToken(Direction.Backward) === 'string';

  useThreadSeedPrewarmController({
    room,
    mx,
    sessionId,
    prefetchDepthRef,
    activeThreadId: undefined,
    priorityTargets: paused ? EMPTY_PREWARM_TARGETS : windowState.priorityThreadSeedPrewarmRoots,
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
  const trusted = useTrustedRoomAccounts(room, env.ignoredUsersSet);

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
    timeline,
  });

  // Shared refs published by RoomRowsTimeline when mounted; fall back while Compact/Spinner shows.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fallbackReturnPlaceRef = useRef<RoomRowsPlace>(undefined);
  const threadReturnPlace = useThreadReturnPlace({
    memoryRef: props.threadReturnPlaceRef ?? fallbackReturnPlaceRef,
    roomId: room.roomId,
    eventId,
    roomRowsShown: !compactViewRequested,
    latestAtTop,
    scrollRef,
  });
  const returnedRef = useRef(false);
  const committedView = `${room.roomId}||${viewMode}`;
  const liveEndViewStateRef = useRef<TimelineLiveEndViewState>({
    view: committedView,
    roomId: room.roomId,
  });
  const hydrating = roomInitialCacheHydratedKey !== room.roomId || clientCatchingUp;
  const rowsTimelineMounted = !(compactCards && (hydrating || threadIndex.showCompactRoomView));
  useLayoutEffect(() => {
    if (!rowsTimelineMounted) {
      liveEndViewStateRef.current = { view: committedView, roomId: room.roomId };
    }
  }, [committedView, room.roomId, rowsTimelineMounted]);
  const expansionState = useTimelineExpansionState();
  const membershipOpenState = useState<ReadonlySet<string>>(() => new Set());
  const isViewportAtLatestNow = useViewportAtBottomNow(scrollRef, atBottomRef, latestAtTopRef);
  const atLiveEndRef = useRef(false);
  const loadedRangeRef = useRef(stateRange);
  const roomRowsRef = useRef(loadedRoomRows);
  const foldedRowsRef = useRef<ReadonlyMap<string, number> | undefined>(undefined);
  const viewportApiRef = useRef<RoomRowsViewportApi | null>(null);
  if (!viewportApiRef.current) {
    atLiveEndRef.current = liveTimelineLinked && stateRange.end >= loadedRoomRows.length;
    loadedRangeRef.current = stateRange;
    roomRowsRef.current = loadedRoomRows;
    foldedRowsRef.current = undefined;
  }
  const viewportApi = useMemo<RoomRowsViewportApi>(
    () => ({
      scrollToItem: (i, o) => viewportApiRef.current?.scrollToItem(i, o) ?? false,
      scrollToElement: (el, o) => viewportApiRef.current?.scrollToElement(el, o) ?? false,
      followOwnSend: () => viewportApiRef.current?.followOwnSend(),
    }),
    []
  );

  const effectiveThreadFilterStateRef = useLatestRef(threadIndex.effectiveThreadFilterState);
  const { handleOpenEvent, openRoomEventRoute } = useRoomEventOpenController({
    ...filters,
    alive,
    effectiveViewMode: viewMode,
    focusEventInRoom: props.focusEventInRoom,
    mx,
    navigateRoomThread: env.navigateRoomThread,
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
    scrollToElement: viewportApi.scrollToElement,
    scrollToItem: viewportApi.scrollToItem,
    searchQuery: threadIndex.searchQuery,
    setFocusItem,
    setTimeline,
    threadFilteredEventsRef: roomRowsRef,
    foldedRowsRef,
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
    entryReturned: props.entryReturned,
    eventId,
    focusEventInRoom: props.focusEventInRoom,
    openRoomEventRoute,
    roomId: room.roomId,
    roomOverviewOrderActive: threadIndex.roomOverviewOrderActive,
  });

  useRoomCacheHydrationController({
    alive,
    buildInitialTimeline,
    eventId,
    focusItemRef,
    mx,
    paused,
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
  });
  useRoomCachedBackState({
    alive,
    eventId,
    eventsLength: renderableEvents.length,
    paused,
    room,
    roomDebugTraceId,
    roomIdRef,
    sessionId,
    setRoomHasMoreCachedBack,
    setTimeline,
    timeline,
  });
  const setRelinkedTimeline = useRelinkKeepingRows({
    alive,
    mx,
    filterOptsRef,
    rebuildTimeline: buildInitialTimeline,
    setTimeline,
  });
  useRoomTimelineResetRelink({
    room,
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
  useThreadAwareTimelineRefresh({ room, liveTimelineLinked, onRoomRefresh: handleRoomRefresh });
  useThreadSummaryPublishController({
    onStoreThreadSummary: props.onStoreThreadSummary,
    room,
    threadSummaryInfoMap: threadIndex.threadSummaryInfoMap,
  });

  const loadedRoomEventCount = useMemo(
    () => timeline.linkedTimelines.reduce((n, part) => n + part.getEvents().length, 0),
    [timeline]
  );
  useCompactCoverageBackfillController({
    roomId: room.roomId,
    enabled: !paused && compactViewRequested && !eventId,
    loadedEventCount: loadedRoomEventCount,
    hasZeroReplyRootCoverage: threadIndex.hasZeroReplyRootCoverage,
    canPaginateBack: canPaginateRoomBack,
    hasMoreCachedBack: roomHasMoreCachedBack,
    paginateBack: paginateRoom,
  });
  useCompactRootEditBackfillController({
    enabled: !paused && (compactViewRequested || threadIndex.roomThreadFilterActive),
    mx,
    overviewThreadRootIds: threadIndex.overviewThreadRootIds,
    beginRoomCacheWrite,
    room,
    roomSurfaceEventEntries: threadIndex.roomSurfaceEventEntries,
    roomThreadListThreads: threadIndex.roomThreadListThreads,
    setOverviewRefreshCounter,
  });
  const { applyThreadOverviewRelationEvents } = threadIndex;
  const applyThreadRelations = useCallback(
    (o: FetchedRelationOverviewUpdateOptions) => {
      recordThreadWriters(
        o.room,
        o.rootId,
        collectThreadWriterIds(o.events, o.rootId),
        o.relationSnapshotComplete === true
      );
      applyThreadOverviewRelationEvents(o);
    },
    [applyThreadOverviewRelationEvents]
  );
  const [peopleListOpened, setPeopleListOpened] = useState<string>();
  const onPeopleListShown = useCallback(() => setPeopleListOpened(room.roomId), [room.roomId]);
  useThreadWritersBackfill({
    room,
    mx,
    sessionId,
    records: paused
      ? EMPTY_THREAD_RECORD_MAP
      : compactViewRequested
        ? threadIndex.compactThreadRecordMap
        : threadIndex.normalThreadRecordMap,
    fetchMissing:
      !paused && (peopleListOpened === room.roomId || (threadFilterState.people?.length ?? 0) > 0),
    onApplyThreadRelations: applyThreadRelations,
    onStoreThreadSummary: props.onStoreThreadSummary,
    beginThreadCacheWrite,
  });
  useThreadOverviewResumeController({
    alive,
    enabled: !uncommittedBackPeek && !paused,
    activeTimelineRange: stateRange,
    compactFilteredThreadRootIds: threadIndex.compactFilteredThreadRootIds,
    compactViewRequested,
    debugTraceId: roomDebugTraceId,
    filteredThreadRootIds: threadIndex.filteredThreadRootIds,
    limit: windowLimit,
    mx,
    onStoreThreadSummary: props.onStoreThreadSummary,
    onApplyThreadRelations: applyThreadRelations,
    beginThreadCacheWrite,
    refreshCompactThreadList: threadIndex.refreshRoomThreadList,
    room,
    sessionId,
    setOverviewRefreshCounter,
    showCompactRoomView: threadIndex.showCompactRoomView,
    threadFilteredEventEntries: windowState.threadFilteredEventEntries,
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
    setTimeline,
  });

  // Live rows. Registered LAST so its timeline listener runs after every other one.
  useRoomLiveRenderController({
    ...filters,
    atBottomRef,
    atLiveEndRef,
    effectiveThreadFilterState: threadIndex.effectiveThreadFilterState,
    hideActivity: settings.hideActivity,
    readsMainTimeline: !compactCards,
    markLiveExpansionCandidate: expansionState.liveExpansion.mark,
    latestAtTopRef,
    onOwnSend: viewportApi.followOwnSend,
    mx,
    normalThreadRecordMap: threadIndex.normalThreadRecordMap,
    onStoreThreadSummary: props.onStoreThreadSummary,
    room,
    roomThreadFilterActive: threadIndex.roomThreadFilterActive,
    scrollRef,
    scrollToBottomRef,
    setTimeline,
    setUnreadInfo,
    classicRows,
    threadResolutionMap,
    timelineAtLiveEnd: atLiveEndRef.current,
    unreadInfo,
  });

  const filterBarShown =
    viewState.showRoomThreadOverviewControls && !plainConversation && !settings.hideThreadFilterBar;
  const sectionsOffered = compactCards && hasMindroomAgents;
  const threadSectionsShown = sectionsOffered && props.threadSections === true;
  const singleBucketTab =
    threadFilterState.tab && threadFilterState.tab !== 'all' ? threadFilterState.tab : undefined;
  const columnsOffered =
    sectionsOffered && Boolean(props.onToggleThreadColumns) && !singleBucketTab;
  const threadColumnsShown = threadSectionsShown && columnsOffered && props.threadColumns === true;
  const overviewOrdering = compactCards
    ? threadIndex.compactOverviewOrdering
    : threadIndex.normalOverviewOrdering;
  const overviewRoots = compactCards
    ? threadIndex.compactThreadRootData
    : threadIndex.visibleThreadRootData;
  const overviewRecords = compactCards
    ? threadIndex.compactThreadRecordMap
    : threadIndex.normalThreadRecordMap;
  const filterBar = filterBarShown && (
    <FilterBarSlot onHeight={setFilterBarHeight}>
      <RoomThreadOverview
        roomId={room.roomId}
        hasMindroomAgents={hasMindroomAgents}
        threadCount={overviewOrdering.displayOrderedIds.length}
        totalThreadCount={overviewRoots.ids.length}
        statusCounts={threadIndex.statusCounts}
        bucketCounts={threadIndex.bucketCounts}
        countsSettled={threadIndex.threadListSettled}
        onSelectTab={props.onSelectTab ?? NOOP}
        tagCounts={threadIndex.tagCounts}
        state={threadFilterState}
        availableTags={threadIndex.availableRoomTags}
        isThreadSortFrozen={!!threadSortFreezeState}
        onSortDirectionChange={props.onSortDirectionChange ?? NOOP}
        onToggleThreadSortFreeze={props.onToggleThreadSortFreeze ?? NOOP}
        onToggleUnresolvedOnly={props.onToggleUnresolvedOnly ?? NOOP}
        onToggleForMe={props.onToggleForMe}
        onReset={props.onReset ?? NOOP}
        onAddTag={props.onAddTag ?? NOOP}
        onRemoveTag={props.onRemoveTag ?? NOOP}
        onClearTags={props.onClearTags ?? NOOP}
        onSearchQueryChange={props.onSearchQueryChange ?? NOOP}
        threadSections={threadSectionsShown}
        onToggleThreadSections={sectionsOffered ? props.onToggleThreadSections : undefined}
        threadColumns={threadColumnsShown}
        onToggleThreadColumns={columnsOffered ? props.onToggleThreadColumns : undefined}
        hideEmptyState={compactCards && threadIndex.showCompactRoomView}
        peopleFilter={
          props.onTogglePerson && (
            <ThreadPeopleFilter
              room={room}
              records={overviewRecords}
              selected={threadFilterState.people}
              onShown={onPeopleListShown}
              onToggle={props.onTogglePerson}
              onClear={props.onClearPeople ?? NOOP}
            />
          )
        }
      />
    </FilterBarSlot>
  );

  return {
    env,
    timeline,
    setTimeline,
    windowLimit,
    roomHasMoreCachedBack,
    firstRoomTimeline,
    liveTimelineLinked,
    paginateRoom,
    threadIndex,
    windowState,
    loadedWindowRows,
    classicRows,
    compactCards,
    latestAtTop,
    trusted,
    unreadInfo,
    setUnreadInfo,
    focusItem,
    setFocusItem,
    atBottom,
    setAtBottom,
    handleOpenEvent,
    filterBar,
    filterBarShown,
    roomStyle: roomViewStyleUnder(filterBar ? filterBarHeight : null),
    hydrating,
    clientCatchingUp,
    threadSectionsShown,
    threadColumnsShown,
    committedView,
    threadReturnPlace,
    returnedRef,
    liveEndViewStateRef,
    expansionState,
    membershipOpenState,
    scrollRef,
    atLiveEndRef,
    loadedRangeRef,
    roomRowsRef,
    foldedRowsRef,
    viewportApiRef,
    atBottomRef,
    readUptoEventIdRef,
    scrollToBottomRef,
    roomPaginatingBackRef,
  };
}

export type RoomSurfaceState = ReturnType<typeof useRoomSurfaceState>;

/**
 * Mount-time gate for Compact mode: when a room list mounts in Compact, listeners start in commit 1
 * and the overview builds once before paint (`useThreadOverviewListenedFirst`).
 */
export function RoomSurface(props: RoomTimelineProps) {
  const listened = useThreadOverviewListenedFirst(
    props.room,
    undefined,
    props.viewMode === 'compact'
  );
  return listened === 'waiting' ? null : (
    <RoomSurfaceContent {...props} listenedOverview={listened} />
  );
}

function RoomSurfaceContent(
  props: RoomTimelineProps & { listenedOverview?: ThreadOverviewRefresh }
) {
  const state = useRoomSurfaceState(props, props.listenedOverview);
  if (state.compactCards && !state.threadIndex.showCompactRoomView && state.hydrating) {
    return (
      <Box grow="Yes" alignItems="Center" justifyContent="Center">
        <Spinner size="400" variant="Secondary" />
      </Box>
    );
  }
  if (state.compactCards && state.threadIndex.showCompactRoomView) {
    return <CompactRoomSurface props={props} state={state} />;
  }
  return <RoomRowsTimeline props={props} state={state} />;
}
