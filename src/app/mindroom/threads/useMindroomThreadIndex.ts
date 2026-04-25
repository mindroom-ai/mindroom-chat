import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { EventTimeline, MatrixClient, MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import { buildThreadSummaryMap, type MindroomThreadSummaryInfo } from '../messages/threadSummary';
import { applyParsedThreadFilterQuery, parseThreadFilterQuery } from './threadFilterDsl';
import { getRoomEventThreadOpenTarget } from './roomDeepLink';
import {
  buildRoomSurfaceEventEntries,
  getLinkedTimelineEvents,
  isVisibleThreadRootEvent,
  type TimelineEventEntry,
} from './roomTimelineEvents';
import {
  createThreadSortControlSignature,
  collectAvailableRoomTags,
  getRoomScheduledTaskCounts,
  isRoomThreadOverviewActive,
  type StatusCounts,
  type ThreadFilterState,
  type ThreadSortFreezeState,
  type VisibleThreadRootData,
} from './roomThreadOverviewModel';
import type { RoomViewMode } from './roomViewMode';
import { buildThreadRecordMap } from './threadRecord';
import {
  computeThreadRecordStatusCounts,
  computeThreadRecordTagCounts,
  resolveThreadRecordOverviewRootIds,
} from './threadRecordOverview';
import { useThreadOverviewCacheHydration } from './threadOverviewCacheHydration';
import {
  resolveFetchedRelationOverviewUpdate,
  type FetchedRelationOverviewUpdateOptions,
} from './threadOverviewCacheHydration';
import type { ThreadCacheCoverage, ThreadRecord } from './types';
import { buildVisibleThreadParticipantMap, buildVisibleThreadReplyCountMap } from './threadUtils';
import {
  DIRECT_ROOM_TIMELINE_FILTER_STATE,
  THREAD_OVERVIEW_METADATA_CACHE_LIMIT,
} from './roomTimelineViewState';
import {
  buildCompactThreadRootData,
  buildCompactZeroReplyRootData,
  getCompactThreadRootBodyPreviewText,
  mergeCompactThreadRootData,
} from './compactThreadRootData';
import { useStateEvents } from './useStateEvents';
import { useRoomThreadList } from './useRoomThreadList';
import { MINDROOM_SCHEDULED_TASK_EVENT } from './scheduledTaskContract';

type ThreadResolutionLike = {
  isResolved: boolean;
  tags: Record<string, unknown> | null;
};

type ThreadIndexOrdering = {
  filteredIds: string[];
  liveOrderedIds: string[];
  displayOrderedIds: string[];
};

const EMPTY_ORDERING: ThreadIndexOrdering = {
  filteredIds: [],
  liveOrderedIds: [],
  displayOrderedIds: [],
};

const setMapEntry = <K, V>(
  setMap: Dispatch<SetStateAction<Map<K, V>>>,
  key: K,
  value: V | undefined
): void => {
  if (value === undefined) return;

  setMap((prev) => {
    if (Object.is(prev.get(key), value)) return prev;
    const next = new Map(prev);
    next.set(key, value);
    return next;
  });
};

export type MindroomThreadIndexSnapshot = {
  showCompactRoomView: boolean;
  normalThreadRecordMap: Map<string, ThreadRecord>;
  compactThreadRecordMap: Map<string, ThreadRecord>;
  threadRecordMap: Map<string, ThreadRecord>;
  normalOverviewOrdering: ThreadIndexOrdering;
  compactOverviewOrdering: ThreadIndexOrdering;
  focusedRoomOverviewRootId: string | undefined;
  focusedRoomOverviewBypass: boolean;
  liveThreadFilterState: ThreadFilterState;
  effectiveThreadFilterState: ThreadFilterState;
  roomThreadFilterRequested: boolean;
  roomThreadFilterActive: boolean;
  filteredThreadRootIds: string[];
  compactFilteredThreadRootIds: string[];
  roomOverviewOrderActive: boolean;
  activeLiveOverviewThreadRootIds: string[];
  overviewThreadRootIds: string[];
  statusCounts: StatusCounts;
  tagCounts: Record<string, number>;
  searchQuery: string;
  threadSortControlSignature: string;
};

export type UseMindroomThreadIndexResult = MindroomThreadIndexSnapshot & {
  roomSurfaceEventEntries: TimelineEventEntry[];
  visibleThreadRootData: VisibleThreadRootData;
  compactThreadRootData: VisibleThreadRootData;
  threadReplyCountMap: Map<string, number>;
  threadParticipantMap: Map<string, string[]>;
  threadSummaryInfoMap: Map<string, MindroomThreadSummaryInfo>;
  scheduledTaskCounts: Map<string, number>;
  availableRoomTags: string[];
  readUpToTs: number | undefined;
  roomThreadListThreads: Thread[];
  refreshRoomThreadList: () => Promise<void>;
  applyThreadOverviewRelationEvents: (options: FetchedRelationOverviewUpdateOptions) => void;
};

export type ResolveMindroomThreadIndexSnapshotOptions = {
  threadId: string | undefined;
  compactViewRequested: boolean;
  visibleThreadRootIds: string[];
  compactThreadRootIds: string[];
  normalThreadRecordMap: Map<string, ThreadRecord>;
  compactThreadRecordMap: Map<string, ThreadRecord>;
  threadFilterState: ThreadFilterState;
  liveThreadFilterState: ThreadFilterState;
  fallbackThreadFilterState: ThreadFilterState;
  searchQuery: string;
  threadSortFreezeState: ThreadSortFreezeState | null;
  threadSortControlSignature: string;
  focusedRoomOverviewRequested: boolean;
  focusedRoomOverviewRootId: string | undefined;
};

export const buildThreadRootEventMap = (
  roomSurfaceEventEntries: TimelineEventEntry[],
  indexMap: ReadonlyMap<string, number>
): Map<string, MatrixEvent> => {
  const eventMap = new Map<string, MatrixEvent>();
  roomSurfaceEventEntries.forEach(({ event }) => {
    const eventId = event.getId();
    if (eventId && indexMap.has(eventId)) {
      eventMap.set(eventId, event);
    }
  });
  return eventMap;
};

export const resolveFocusedRoomOverviewRootId = ({
  eventId,
  room,
  roomThreads = [],
  threadResolutionMap,
  threadReplyCountMap,
}: {
  eventId: string;
  room: Room;
  roomThreads?: Array<Pick<Thread, 'id' | 'rootEvent'>>;
  threadResolutionMap: Map<string, { isResolved: boolean }>;
  threadReplyCountMap?: Map<string, number>;
}): string | undefined => {
  const threadTarget = getRoomEventThreadOpenTarget({
    eventId,
    room,
    roomThreads,
  });
  if (threadTarget?.threadId) return threadTarget.threadId;

  const targetEvent =
    room.findEventById(eventId) ?? roomThreads.find((thread) => thread.id === eventId)?.rootEvent;
  if (
    targetEvent &&
    isVisibleThreadRootEvent(targetEvent, room, threadResolutionMap, threadReplyCountMap)
  ) {
    return eventId;
  }

  return undefined;
};

export const resolveMindroomThreadIndexSnapshot = ({
  threadId,
  compactViewRequested,
  visibleThreadRootIds,
  compactThreadRootIds,
  normalThreadRecordMap,
  compactThreadRecordMap,
  threadFilterState,
  liveThreadFilterState,
  fallbackThreadFilterState,
  searchQuery,
  threadSortFreezeState,
  threadSortControlSignature,
  focusedRoomOverviewRequested,
  focusedRoomOverviewRootId,
}: ResolveMindroomThreadIndexSnapshotOptions): MindroomThreadIndexSnapshot => {
  const showCompactRoomView = compactViewRequested && compactThreadRootIds.length > 0;
  const threadRecordMap = showCompactRoomView ? compactThreadRecordMap : normalThreadRecordMap;
  const normalOverviewOrdering = threadId
    ? EMPTY_ORDERING
    : resolveThreadRecordOverviewRootIds({
        threadRootIds: visibleThreadRootIds,
        threadFilterState,
        searchQuery,
        recordMap: normalThreadRecordMap,
        threadSortFreezeState,
        threadSortControlSignature,
      });

  const focusedRoomOverviewBypass =
    focusedRoomOverviewRequested &&
    (!focusedRoomOverviewRootId ||
      !normalOverviewOrdering.filteredIds.includes(focusedRoomOverviewRootId));
  const effectiveThreadFilterState = focusedRoomOverviewBypass
    ? fallbackThreadFilterState
    : threadFilterState;
  const roomThreadFilterRequested =
    isRoomThreadOverviewActive(threadId, liveThreadFilterState) || focusedRoomOverviewRequested;
  const roomThreadFilterActive = roomThreadFilterRequested && !focusedRoomOverviewBypass;
  const compactOverviewOrdering =
    threadId || !compactViewRequested
      ? normalOverviewOrdering
      : resolveThreadRecordOverviewRootIds({
          threadRootIds: compactThreadRootIds,
          threadFilterState,
          searchQuery,
          recordMap: compactThreadRecordMap,
          threadSortFreezeState,
          threadSortControlSignature,
        });
  const filteredThreadRootIds = threadId
    ? visibleThreadRootIds
    : normalOverviewOrdering.filteredIds;
  const compactFilteredThreadRootIds = threadId
    ? compactThreadRootIds
    : compactOverviewOrdering.filteredIds;
  const roomOverviewOrderActive = roomThreadFilterActive || showCompactRoomView;
  const activeLiveOverviewThreadRootIds = showCompactRoomView
    ? compactOverviewOrdering.liveOrderedIds
    : normalOverviewOrdering.liveOrderedIds;
  const overviewThreadRootIds = showCompactRoomView
    ? compactOverviewOrdering.displayOrderedIds
    : roomThreadFilterActive
    ? normalOverviewOrdering.displayOrderedIds
    : [];
  const countThreadRootIds = showCompactRoomView ? compactThreadRootIds : visibleThreadRootIds;

  return {
    showCompactRoomView,
    normalThreadRecordMap,
    compactThreadRecordMap,
    threadRecordMap,
    normalOverviewOrdering,
    compactOverviewOrdering,
    focusedRoomOverviewRootId,
    focusedRoomOverviewBypass,
    liveThreadFilterState,
    effectiveThreadFilterState,
    roomThreadFilterRequested,
    roomThreadFilterActive,
    filteredThreadRootIds,
    compactFilteredThreadRootIds,
    roomOverviewOrderActive,
    activeLiveOverviewThreadRootIds,
    overviewThreadRootIds,
    statusCounts: computeThreadRecordStatusCounts(countThreadRootIds, threadRecordMap),
    tagCounts: computeThreadRecordTagCounts(countThreadRootIds, threadRecordMap),
    searchQuery,
    threadSortControlSignature,
  };
};

export type UseMindroomThreadIndexOptions = {
  room: Room;
  threadId: string | undefined;
  eventId: string | undefined;
  focusedRoomOverviewRequested: boolean;
  compactViewRequested: boolean;
  effectiveViewMode: RoomViewMode;
  linkedTimelines: EventTimeline[];
  renderableEventEntries: TimelineEventEntry[];
  ignoredUsersSet: Set<string>;
  showHiddenEvents: boolean;
  hideMembershipEvents: boolean;
  hideNickAvatarEvents: boolean;
  summaryMap: ReadonlyMap<string, MindroomThreadSummaryInfo>;
  threadResolutionMap: Map<string, ThreadResolutionLike>;
  currentUserId: string | undefined;
  requestedThreadFilterState: ThreadFilterState;
  threadSortFreezeState: ThreadSortFreezeState | null;
  overviewRefreshCounter: number;
  sessionId: string;
  mx: MatrixClient;
  onStoreThreadSummary: (threadRootId: string, info: MindroomThreadSummaryInfo | undefined) => void;
};

export const useMindroomThreadIndex = ({
  room,
  threadId,
  eventId,
  focusedRoomOverviewRequested,
  compactViewRequested,
  effectiveViewMode,
  linkedTimelines,
  renderableEventEntries,
  ignoredUsersSet,
  showHiddenEvents,
  hideMembershipEvents,
  hideNickAvatarEvents,
  summaryMap,
  threadResolutionMap,
  currentUserId,
  requestedThreadFilterState,
  threadSortFreezeState,
  overviewRefreshCounter,
  sessionId,
  mx,
  onStoreThreadSummary,
}: UseMindroomThreadIndexOptions): UseMindroomThreadIndexResult => {
  const loadedTimelineEvents = useMemo(() => {
    if (threadId) return [] as MatrixEvent[];
    return getLinkedTimelineEvents(linkedTimelines);
  }, [threadId, linkedTimelines]);
  const threadReplyCountMap = useMemo(
    () =>
      threadId ? new Map<string, number>() : buildVisibleThreadReplyCountMap(loadedTimelineEvents),
    [threadId, loadedTimelineEvents]
  );
  const threadParticipantMap = useMemo(
    () =>
      threadId
        ? new Map<string, string[]>()
        : buildVisibleThreadParticipantMap(loadedTimelineEvents),
    [threadId, loadedTimelineEvents]
  );
  const threadSummaryInfoMap = useMemo(
    () =>
      threadId
        ? new Map<string, MindroomThreadSummaryInfo>()
        : buildThreadSummaryMap(loadedTimelineEvents),
    [threadId, loadedTimelineEvents]
  );
  const scheduledTaskEvents = useStateEvents(room, MINDROOM_SCHEDULED_TASK_EVENT);
  const scheduledTaskCounts = useMemo(
    () => (threadId ? new Map<string, number>() : getRoomScheduledTaskCounts(scheduledTaskEvents)),
    [threadId, scheduledTaskEvents]
  );
  const availableRoomTags = useMemo(
    () => collectAvailableRoomTags(threadResolutionMap),
    [threadResolutionMap]
  );
  const roomSurfaceEventEntries = useMemo(() => {
    // Mutable SDK/event metadata can change without changing the timeline array identity.
    void overviewRefreshCounter;
    if (threadId) return renderableEventEntries;
    return buildRoomSurfaceEventEntries({
      renderableEventEntries,
      linkedTimelines,
      room,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      threadReplyCountMap,
      threadResolutionMap,
    });
  }, [
    threadId,
    renderableEventEntries,
    linkedTimelines,
    room,
    ignoredUsersSet,
    showHiddenEvents,
    hideMembershipEvents,
    hideNickAvatarEvents,
    threadReplyCountMap,
    threadResolutionMap,
    overviewRefreshCounter,
  ]);
  const visibleThreadRootData = useMemo(() => {
    const ids: string[] = [];
    const indexMap = new Map<string, number>();
    const bodyMap = new Map<string, string>();
    roomSurfaceEventEntries.forEach(({ event, absoluteIndex }) => {
      const evtId = event.getId();
      if (!evtId) return;
      if (isVisibleThreadRootEvent(event, room, threadResolutionMap, threadReplyCountMap)) {
        ids.push(evtId);
        indexMap.set(evtId, absoluteIndex);
        const body = getCompactThreadRootBodyPreviewText(event, {
          eventId: evtId,
          room,
        });
        if (body) bodyMap.set(evtId, body);
      }
    });
    return { ids, indexMap, bodyMap };
  }, [roomSurfaceEventEntries, room, threadResolutionMap, threadReplyCountMap]);
  const { threads: roomThreadListThreads, retry: refreshRoomThreadList } = useRoomThreadList(
    room,
    compactViewRequested
  );
  const compactThreadRootData = useMemo(() => {
    if (threadId || !compactViewRequested) {
      return visibleThreadRootData;
    }

    const baseCompactThreadRootData = buildCompactThreadRootData({
      room,
      visibleIds: visibleThreadRootData.ids,
      visibleIndexMap: visibleThreadRootData.indexMap,
      visibleBodyMap: visibleThreadRootData.bodyMap,
      threads: roomThreadListThreads,
    });
    const compactZeroReplyRootData = buildCompactZeroReplyRootData({
      room,
      roomSurfaceEntries: roomSurfaceEventEntries,
      knownThreadRootIds: baseCompactThreadRootData.ids,
    });

    return mergeCompactThreadRootData(baseCompactThreadRootData, compactZeroReplyRootData);
  }, [
    threadId,
    compactViewRequested,
    room,
    roomSurfaceEventEntries,
    visibleThreadRootData,
    roomThreadListThreads,
  ]);
  const readUpToTs = useMemo(() => {
    // Receipts mutate on the room object, so the overview refresh tick is intentional.
    void overviewRefreshCounter;
    if (threadId || !currentUserId) return undefined;
    const readUpToId = room.getEventReadUpTo(currentUserId);
    if (!readUpToId) return undefined;
    const readUpToEvent = room.findEventById(readUpToId);
    return readUpToEvent?.getTs();
  }, [threadId, room, currentUserId, overviewRefreshCounter]);
  const [compactCachedThreadRootBodyMap, setCompactCachedThreadRootBodyMap] = useState(
    () => new Map<string, string>()
  );
  const [cachedThreadLastActivityTsMap, setCachedThreadLastActivityTsMap] = useState(
    () => new Map<string, number>()
  );
  const [cachedThreadLatestReplyPreviewMap, setCachedThreadLatestReplyPreviewMap] = useState(
    () => new Map<string, string>()
  );
  const [cachedThreadLastSenderIdMap, setCachedThreadLastSenderIdMap] = useState(
    () => new Map<string, string>()
  );
  const [cachedThreadMessageCountMap, setCachedThreadMessageCountMap] = useState(
    () => new Map<string, number>()
  );
  const [cachedThreadCoverageMap, setCachedThreadCoverageMap] = useState(
    () => new Map<string, ThreadCacheCoverage>()
  );
  const compactCachedRootPreviewAttemptCountsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    compactCachedRootPreviewAttemptCountsRef.current = new Map();
    setCompactCachedThreadRootBodyMap(new Map());
    setCachedThreadLastActivityTsMap(new Map());
    setCachedThreadLatestReplyPreviewMap(new Map());
    setCachedThreadLastSenderIdMap(new Map());
    setCachedThreadMessageCountMap(new Map());
    setCachedThreadCoverageMap(new Map());
  }, [room.roomId]);

  const compactThreadRootBodyMap = useMemo(() => {
    const bodyMap = new Map(compactThreadRootData.bodyMap);
    compactCachedThreadRootBodyMap.forEach((value, key) => {
      bodyMap.set(key, value);
    });
    return bodyMap;
  }, [compactThreadRootData.bodyMap, compactCachedThreadRootBodyMap]);

  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(
    requestedThreadFilterState.searchQuery ?? ''
  );

  const liveParsedQuery = useMemo(
    () => parseThreadFilterQuery(requestedThreadFilterState.searchQuery ?? ''),
    [requestedThreadFilterState.searchQuery]
  );
  const liveThreadFilterState = useMemo(
    () => applyParsedThreadFilterQuery(requestedThreadFilterState, liveParsedQuery),
    [requestedThreadFilterState, liveParsedQuery]
  );

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearchQuery(requestedThreadFilterState.searchQuery ?? ''),
      300
    );
    return () => clearTimeout(timer);
  }, [requestedThreadFilterState.searchQuery]);

  const debouncedParsedQuery = useMemo(
    () => parseThreadFilterQuery(debouncedSearchQuery),
    [debouncedSearchQuery]
  );
  const debouncedThreadFilterState = useMemo(
    () => applyParsedThreadFilterQuery(requestedThreadFilterState, debouncedParsedQuery),
    [requestedThreadFilterState, debouncedParsedQuery]
  );
  const threadSortControlSignature = useMemo(
    () =>
      createThreadSortControlSignature({
        state: debouncedThreadFilterState,
        searchQuery: debouncedParsedQuery.freeText,
        viewMode: effectiveViewMode,
      }),
    [debouncedThreadFilterState, debouncedParsedQuery.freeText, effectiveViewMode]
  );
  const visibleThreadRootEventMap = useMemo(
    () => buildThreadRootEventMap(roomSurfaceEventEntries, visibleThreadRootData.indexMap),
    [roomSurfaceEventEntries, visibleThreadRootData.indexMap]
  );
  const compactThreadRootEventMap = useMemo(
    () => buildThreadRootEventMap(roomSurfaceEventEntries, compactThreadRootData.indexMap),
    [roomSurfaceEventEntries, compactThreadRootData.indexMap]
  );
  const normalThreadRecordMap = useMemo(() => {
    // External hydration can refresh mutable SDK/cache-backed sources without changing map identity.
    void overviewRefreshCounter;
    if (threadId) return new Map<string, ThreadRecord>();

    return buildThreadRecordMap({
      room,
      threadRootIds: visibleThreadRootData.ids,
      threadRootEventMap: visibleThreadRootEventMap,
      summaryMap,
      fallbackSummaryMap: threadSummaryInfoMap,
      fallbackReplyCountMap: threadReplyCountMap,
      rootPreviewTextMap: visibleThreadRootData.bodyMap,
      fallbackLatestReplyPreviewMap: cachedThreadLatestReplyPreviewMap,
      fallbackLastSenderIdMap: cachedThreadLastSenderIdMap,
      fallbackMessageCountMap: cachedThreadMessageCountMap,
      fallbackLastActivityTsMap: cachedThreadLastActivityTsMap,
      fallbackParticipantMap: threadParticipantMap,
      threadResolutionMap,
      currentUserId,
      readUpToTs: readUpToTs ?? null,
      scheduledTaskEvents,
      scheduledTaskCounts,
      cacheCoverageMap: cachedThreadCoverageMap,
      absoluteIndexMap: visibleThreadRootData.indexMap,
    });
  }, [
    threadId,
    room,
    visibleThreadRootData.ids,
    visibleThreadRootData.indexMap,
    visibleThreadRootData.bodyMap,
    visibleThreadRootEventMap,
    summaryMap,
    threadSummaryInfoMap,
    threadReplyCountMap,
    cachedThreadLatestReplyPreviewMap,
    cachedThreadLastSenderIdMap,
    cachedThreadMessageCountMap,
    cachedThreadLastActivityTsMap,
    cachedThreadCoverageMap,
    threadParticipantMap,
    threadResolutionMap,
    currentUserId,
    readUpToTs,
    scheduledTaskEvents,
    scheduledTaskCounts,
    overviewRefreshCounter,
  ]);
  const compactThreadRecordMap = useMemo(() => {
    // External hydration can refresh mutable SDK/cache-backed sources without changing map identity.
    void overviewRefreshCounter;
    if (threadId) return new Map<string, ThreadRecord>();
    if (!compactViewRequested) return normalThreadRecordMap;

    return buildThreadRecordMap({
      room,
      threadRootIds: compactThreadRootData.ids,
      threadRootEventMap: compactThreadRootEventMap,
      summaryMap,
      fallbackSummaryMap: threadSummaryInfoMap,
      fallbackReplyCountMap: threadReplyCountMap,
      rootPreviewTextMap: compactThreadRootBodyMap,
      fallbackLatestReplyPreviewMap: cachedThreadLatestReplyPreviewMap,
      fallbackLastSenderIdMap: cachedThreadLastSenderIdMap,
      fallbackMessageCountMap: cachedThreadMessageCountMap,
      fallbackLastActivityTsMap: cachedThreadLastActivityTsMap,
      fallbackParticipantMap: threadParticipantMap,
      threadResolutionMap,
      currentUserId,
      readUpToTs: readUpToTs ?? null,
      scheduledTaskEvents,
      scheduledTaskCounts,
      cacheCoverageMap: cachedThreadCoverageMap,
      absoluteIndexMap: compactThreadRootData.indexMap,
    });
  }, [
    threadId,
    compactViewRequested,
    normalThreadRecordMap,
    room,
    compactThreadRootData.ids,
    compactThreadRootData.indexMap,
    compactThreadRootEventMap,
    compactThreadRootBodyMap,
    summaryMap,
    threadSummaryInfoMap,
    threadReplyCountMap,
    cachedThreadLatestReplyPreviewMap,
    cachedThreadLastSenderIdMap,
    cachedThreadMessageCountMap,
    cachedThreadLastActivityTsMap,
    cachedThreadCoverageMap,
    threadParticipantMap,
    threadResolutionMap,
    currentUserId,
    readUpToTs,
    scheduledTaskEvents,
    scheduledTaskCounts,
    overviewRefreshCounter,
  ]);
  const focusedRoomOverviewRootId = useMemo(
    () =>
      focusedRoomOverviewRequested && eventId
        ? resolveFocusedRoomOverviewRootId({
            eventId,
            room,
            roomThreads: roomThreadListThreads,
            threadResolutionMap,
            threadReplyCountMap,
          })
        : undefined,
    [
      eventId,
      threadReplyCountMap,
      focusedRoomOverviewRequested,
      room,
      roomThreadListThreads,
      threadResolutionMap,
    ]
  );

  const snapshot = useMemo(
    () =>
      resolveMindroomThreadIndexSnapshot({
        threadId,
        compactViewRequested,
        visibleThreadRootIds: visibleThreadRootData.ids,
        compactThreadRootIds: compactThreadRootData.ids,
        normalThreadRecordMap,
        compactThreadRecordMap,
        threadFilterState: debouncedThreadFilterState,
        liveThreadFilterState,
        fallbackThreadFilterState: DIRECT_ROOM_TIMELINE_FILTER_STATE,
        searchQuery: debouncedParsedQuery.freeText,
        threadSortFreezeState,
        threadSortControlSignature,
        focusedRoomOverviewRequested,
        focusedRoomOverviewRootId,
      }),
    [
      threadId,
      compactViewRequested,
      visibleThreadRootData.ids,
      compactThreadRootData.ids,
      normalThreadRecordMap,
      compactThreadRecordMap,
      debouncedThreadFilterState,
      liveThreadFilterState,
      debouncedParsedQuery.freeText,
      threadSortFreezeState,
      threadSortControlSignature,
      focusedRoomOverviewRequested,
      focusedRoomOverviewRootId,
    ]
  );

  useThreadOverviewCacheHydration({
    threadId,
    overviewThreadRootIds: snapshot.overviewThreadRootIds,
    overviewThreadMetadataCacheLimit: THREAD_OVERVIEW_METADATA_CACHE_LIMIT,
    room,
    roomThreadListThreads,
    sessionId,
    mx,
    showCompactRoomView: snapshot.showCompactRoomView,
    compactThreadRootBodyMap: compactThreadRootData.bodyMap,
    compactCachedThreadRootBodyMap,
    cachedThreadLastActivityTsMap,
    cachedThreadCoverageMap,
    compactThreadRecordMap: snapshot.compactThreadRecordMap,
    threadRecordMap: snapshot.normalThreadRecordMap,
    compactCachedRootPreviewAttemptCountsRef,
    setCompactCachedThreadRootBodyMap,
    setCachedThreadLastActivityTsMap,
    setCachedThreadLatestReplyPreviewMap,
    setCachedThreadLastSenderIdMap,
    setCachedThreadMessageCountMap,
    setCachedThreadCoverageMap,
    onStoreThreadSummary,
  });

  const applyThreadOverviewRelationEvents = useCallback(
    (options: FetchedRelationOverviewUpdateOptions) => {
      if (threadId) return;

      const rootId = options.rootId;
      const currentRecord = (
        snapshot.showCompactRoomView ? compactThreadRecordMap : normalThreadRecordMap
      ).get(rootId);
      const rootEvent =
        options.rootEvent ??
        room.findEventById(rootId) ??
        room.getThread(rootId)?.rootEvent ??
        roomThreadListThreads.find((thread) => thread.id === rootId)?.rootEvent ??
        undefined;
      const update = resolveFetchedRelationOverviewUpdate({
        ...options,
        currentRecord,
        rootEvent,
        room,
      });
      if (!update) return;

      setMapEntry(setCachedThreadLastActivityTsMap, rootId, update.nextActivityTs);
      setMapEntry(setCachedThreadLatestReplyPreviewMap, rootId, update.nextReplyPreviewText);
      setMapEntry(setCachedThreadLastSenderIdMap, rootId, update.nextLastSenderId);
      setMapEntry(setCachedThreadMessageCountMap, rootId, update.nextMessageCount);
      setMapEntry(setCachedThreadCoverageMap, rootId, update.nextCacheCoverage);

      if (update.nextSummaryInfo?.summaryText) {
        onStoreThreadSummary(rootId, update.nextSummaryInfo);
      }
    },
    [
      compactThreadRecordMap,
      normalThreadRecordMap,
      onStoreThreadSummary,
      room,
      roomThreadListThreads,
      snapshot.showCompactRoomView,
      threadId,
    ]
  );

  return {
    ...snapshot,
    roomSurfaceEventEntries,
    visibleThreadRootData,
    compactThreadRootData,
    threadReplyCountMap,
    threadParticipantMap,
    threadSummaryInfoMap,
    scheduledTaskCounts,
    availableRoomTags,
    readUpToTs,
    roomThreadListThreads,
    refreshRoomThreadList,
    applyThreadOverviewRelationEvents,
  };
};
