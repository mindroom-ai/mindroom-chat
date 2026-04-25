import { useEffect, useMemo, useRef, useState } from 'react';
import type { MatrixClient, MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import type { MindroomThreadSummaryInfo } from '../../components/message/mindroomThreadSummary';
import {
  applyParsedThreadFilterQuery,
  parseThreadFilterQuery,
} from './threadFilterDsl';
import { getRoomEventThreadOpenTarget } from './roomDeepLink';
import {
  isVisibleThreadRootEvent,
  type TimelineEventEntry,
} from './roomTimelineEvents';
import {
  createThreadSortControlSignature,
  isRoomThreadOverviewActive,
  type StatusCounts,
  type ThreadFilterState,
  type ThreadSortFreezeState,
  type VisibleThreadRootData,
} from './roomThreadOverviewModel';
import type { RoomViewMode } from '../../state/room/roomViewMode';
import { buildThreadRecordMap } from './threadRecord';
import {
  computeThreadRecordStatusCounts,
  computeThreadRecordTagCounts,
  resolveThreadRecordOverviewRootIds,
} from './threadRecordOverview';
import { useThreadOverviewCacheHydration } from './threadOverviewCacheHydration';
import type { ThreadRecord } from './types';

type ThreadResolutionLike = {
  isResolved: boolean;
  tags?: Record<string, unknown> | null;
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

export type MindroomThreadIndexSnapshot = {
  showCompactRoomView: boolean;
  normalThreadRecordMap: Map<string, ThreadRecord>;
  compactThreadRecordMap: Map<string, ThreadRecord>;
  threadRecordMap: Map<string, ThreadRecord>;
  normalOverviewOrdering: ThreadIndexOrdering;
  compactOverviewOrdering: ThreadIndexOrdering;
  focusedRoomOverviewRootId: string | undefined;
  focusedRoomOverviewBypass: boolean;
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
  roomSurfaceEventEntries: TimelineEventEntry[];
  visibleThreadRootData: VisibleThreadRootData;
  compactThreadRootData: VisibleThreadRootData;
  summaryMap: ReadonlyMap<string, MindroomThreadSummaryInfo>;
  fallbackSummaryMap: ReadonlyMap<string, MindroomThreadSummaryInfo>;
  fallbackReplyCountMap: Map<string, number>;
  fallbackParticipantMap: ReadonlyMap<string, string[]>;
  threadResolutionMap: Map<string, ThreadResolutionLike>;
  currentUserId: string | undefined;
  readUpToTs: number | null | undefined;
  scheduledTaskEvents: MatrixEvent[];
  scheduledTaskCounts: ReadonlyMap<string, number>;
  requestedThreadFilterState: ThreadFilterState;
  liveThreadFilterState: ThreadFilterState;
  fallbackThreadFilterState: ThreadFilterState;
  threadSortFreezeState: ThreadSortFreezeState | null;
  roomThreadListThreads: Array<Pick<Thread, 'id' | 'rootEvent'>>;
  overviewRefreshCounter: number;
  overviewThreadMetadataCacheLimit: number;
  sessionId: string;
  mx: MatrixClient;
  onStoreThreadSummary: (
    threadRootId: string,
    info: MindroomThreadSummaryInfo | undefined
  ) => void;
};

export const useMindroomThreadIndex = ({
  room,
  threadId,
  eventId,
  focusedRoomOverviewRequested,
  compactViewRequested,
  effectiveViewMode,
  roomSurfaceEventEntries,
  visibleThreadRootData,
  compactThreadRootData,
  summaryMap,
  fallbackSummaryMap,
  fallbackReplyCountMap,
  fallbackParticipantMap,
  threadResolutionMap,
  currentUserId,
  readUpToTs,
  scheduledTaskEvents,
  scheduledTaskCounts,
  requestedThreadFilterState,
  liveThreadFilterState,
  fallbackThreadFilterState,
  threadSortFreezeState,
  roomThreadListThreads,
  overviewRefreshCounter,
  overviewThreadMetadataCacheLimit,
  sessionId,
  mx,
  onStoreThreadSummary,
}: UseMindroomThreadIndexOptions): MindroomThreadIndexSnapshot => {
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
  const compactCachedRootPreviewAttemptCountsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    compactCachedRootPreviewAttemptCountsRef.current = new Map();
    setCompactCachedThreadRootBodyMap(new Map());
    setCachedThreadLastActivityTsMap(new Map());
    setCachedThreadLatestReplyPreviewMap(new Map());
    setCachedThreadLastSenderIdMap(new Map());
    setCachedThreadMessageCountMap(new Map());
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
      fallbackSummaryMap,
      fallbackReplyCountMap,
      rootPreviewTextMap: visibleThreadRootData.bodyMap,
      fallbackLatestReplyPreviewMap: cachedThreadLatestReplyPreviewMap,
      fallbackLastSenderIdMap: cachedThreadLastSenderIdMap,
      fallbackMessageCountMap: cachedThreadMessageCountMap,
      fallbackLastActivityTsMap: cachedThreadLastActivityTsMap,
      fallbackParticipantMap,
      threadResolutionMap,
      currentUserId,
      readUpToTs: readUpToTs ?? null,
      scheduledTaskEvents,
      scheduledTaskCounts,
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
    fallbackSummaryMap,
    fallbackReplyCountMap,
    cachedThreadLatestReplyPreviewMap,
    cachedThreadLastSenderIdMap,
    cachedThreadMessageCountMap,
    cachedThreadLastActivityTsMap,
    fallbackParticipantMap,
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
      fallbackSummaryMap,
      fallbackReplyCountMap,
      rootPreviewTextMap: compactThreadRootBodyMap,
      fallbackLatestReplyPreviewMap: cachedThreadLatestReplyPreviewMap,
      fallbackLastSenderIdMap: cachedThreadLastSenderIdMap,
      fallbackMessageCountMap: cachedThreadMessageCountMap,
      fallbackLastActivityTsMap: cachedThreadLastActivityTsMap,
      fallbackParticipantMap,
      threadResolutionMap,
      currentUserId,
      readUpToTs: readUpToTs ?? null,
      scheduledTaskEvents,
      scheduledTaskCounts,
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
    fallbackSummaryMap,
    fallbackReplyCountMap,
    cachedThreadLatestReplyPreviewMap,
    cachedThreadLastSenderIdMap,
    cachedThreadMessageCountMap,
    cachedThreadLastActivityTsMap,
    fallbackParticipantMap,
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
            threadReplyCountMap: fallbackReplyCountMap,
          })
        : undefined,
    [
      eventId,
      fallbackReplyCountMap,
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
        fallbackThreadFilterState,
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
      fallbackThreadFilterState,
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
    overviewThreadMetadataCacheLimit,
    room,
    roomThreadListThreads,
    sessionId,
    mx,
    showCompactRoomView: snapshot.showCompactRoomView,
    compactThreadRootBodyMap: compactThreadRootData.bodyMap,
    compactCachedThreadRootBodyMap,
    cachedThreadLastActivityTsMap,
    compactThreadRecordMap: snapshot.compactThreadRecordMap,
    threadRecordMap: snapshot.normalThreadRecordMap,
    compactCachedRootPreviewAttemptCountsRef,
    setCompactCachedThreadRootBodyMap,
    setCachedThreadLastActivityTsMap,
    setCachedThreadLatestReplyPreviewMap,
    setCachedThreadLastSenderIdMap,
    setCachedThreadMessageCountMap,
    onStoreThreadSummary,
  });

  return snapshot;
};
