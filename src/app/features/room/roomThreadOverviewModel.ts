import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import {
  getLatestThreadSummaryInfoFromEventSources,
  type MindroomThreadSummaryInfo,
} from '../../components/message/mindroomThreadSummary';
import { getThreadLastActivityTs } from '../../hooks/useThreadLastActivityTs';
import { getThreadStreamingState } from '../../hooks/useThreadStreamingState';
import { trimReplyFromBody } from '../../utils/room';
import {
  getCompactThreadRootBodyPreviewText,
  isNestedThreadReplyEvent,
  isZeroReplyStandaloneThreadRootEvent,
  pickPreferredThreadRootPreviewText,
} from './compactThreadRootData';
import { parseScheduledTaskStateEvent } from '../../utils/scheduledTaskContract';
import type { RoomViewMode } from '../../state/room/roomViewMode';

// ─── Tri-state types ─────────────────────────────────────────────────────────

export type TriState = 'any' | 'include' | 'exclude';

export type ThreadFilterKey = 'resolved' | 'streaming' | 'scheduled' | 'unread' | 'idle';

export interface ThreadFilterState {
  // Status toggles
  resolved: TriState;
  streaming: TriState;
  scheduled: TriState;
  unread: TriState;
  idle: TriState;
  sortBy: 'natural' | 'lastReply';
  sortDirection: 'asc' | 'desc';
  // Tag filters
  tags: Map<string, TriState>;
  // Search
  searchQuery: string;
  // OR/AND mode for status include filters (presets can set 'or')
  statusMode: 'and' | 'or';
}

export type ThreadSortFreezeState = {
  controlSignature: string | null;
  orderedRootIds: string[];
};

export const createDefaultThreadFilterState = (): ThreadFilterState => ({
  resolved: 'any',
  streaming: 'any',
  scheduled: 'any',
  unread: 'any',
  idle: 'any',
  sortBy: 'lastReply',
  sortDirection: 'desc',
  tags: new Map(),
  searchQuery: '',
  statusMode: 'and',
});

export interface SerializedThreadFilterState {
  v: 1;
  resolved: TriState;
  streaming: TriState;
  scheduled: TriState;
  unread: TriState;
  idle: TriState;
  sortBy: ThreadFilterState['sortBy'];
  sortDirection: ThreadFilterState['sortDirection'];
  tags: Record<string, Exclude<TriState, 'any'>>;
  searchQuery?: string;
  statusMode?: ThreadFilterState['statusMode'];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isTriState = (value: unknown): value is TriState =>
  value === 'any' || value === 'include' || value === 'exclude';

const isStoredTagTriState = (value: unknown): value is Exclude<TriState, 'any'> =>
  value === 'include' || value === 'exclude';

const isSortBy = (value: unknown): value is ThreadFilterState['sortBy'] =>
  value === 'natural' || value === 'lastReply';

const isSortDirection = (value: unknown): value is ThreadFilterState['sortDirection'] =>
  value === 'asc' || value === 'desc';

const isStatusMode = (value: unknown): value is ThreadFilterState['statusMode'] =>
  value === 'and' || value === 'or';

export const serializeThreadFilterState = (
  state: ThreadFilterState
): SerializedThreadFilterState => {
  const sortBy = isSortBy(state.sortBy) ? state.sortBy : 'natural';
  const sortDirection =
    sortBy === 'natural' ? 'desc' : isSortDirection(state.sortDirection) ? state.sortDirection : 'desc';
  const searchQuery = typeof state.searchQuery === 'string' ? state.searchQuery : '';
  const statusMode = isStatusMode(state.statusMode) ? state.statusMode : 'and';

  const tags = Object.fromEntries(
    [...state.tags.entries()]
      .filter((entry): entry is [string, Exclude<TriState, 'any'>] => isStoredTagTriState(entry[1]))
      .sort(([tagA], [tagB]) => tagA.localeCompare(tagB))
  );

  return {
    v: 1,
    resolved: isTriState(state.resolved) ? state.resolved : 'any',
    streaming: isTriState(state.streaming) ? state.streaming : 'any',
    scheduled: isTriState(state.scheduled) ? state.scheduled : 'any',
    unread: isTriState(state.unread) ? state.unread : 'any',
    idle: isTriState(state.idle) ? state.idle : 'any',
    sortBy,
    sortDirection,
    tags,
    searchQuery,
    statusMode,
  };
};

const DEFAULT_SERIALIZED_THREAD_FILTER_STATE = JSON.stringify(
  serializeThreadFilterState(createDefaultThreadFilterState())
);

export const deserializeThreadFilterState = (value: unknown): ThreadFilterState => {
  const defaultState = createDefaultThreadFilterState();

  if (!isRecord(value) || value.v !== 1) {
    return defaultState;
  }

  const sortBy = isSortBy(value.sortBy) ? value.sortBy : defaultState.sortBy;
  const rawSortDirection = isSortDirection(value.sortDirection)
    ? value.sortDirection
    : defaultState.sortDirection;
  const sortDirection = sortBy === 'natural' ? 'desc' : rawSortDirection;
  const searchQuery =
    typeof value.searchQuery === 'string' ? value.searchQuery : defaultState.searchQuery;
  const statusMode = isStatusMode(value.statusMode) ? value.statusMode : defaultState.statusMode;

  const tags = new Map<string, TriState>();
  if (isRecord(value.tags)) {
    Object.entries(value.tags)
      .sort(([tagA], [tagB]) => tagA.localeCompare(tagB))
      .forEach(([tagName, tagState]) => {
        if (isStoredTagTriState(tagState)) {
          tags.set(tagName, tagState);
        }
      });
  }

  return {
    resolved: isTriState(value.resolved) ? value.resolved : defaultState.resolved,
    streaming: isTriState(value.streaming) ? value.streaming : defaultState.streaming,
    scheduled: isTriState(value.scheduled) ? value.scheduled : defaultState.scheduled,
    unread: isTriState(value.unread) ? value.unread : defaultState.unread,
    idle: isTriState(value.idle) ? value.idle : defaultState.idle,
    sortBy,
    sortDirection,
    tags,
    searchQuery,
    statusMode,
  };
};

// ─── Core metadata types ─────────────────────────────────────────────────────

export type ThreadOverviewMetadata = {
  isResolved: boolean;
  isUnread: boolean;
  isStreaming: boolean;
  scheduledTaskCount: number;
  lastActivityTs: number;
  absoluteIndex: number;
  lastSenderId: string | undefined;
  lastSenderDisplayName: string | undefined;
  participantDisplayName: string | undefined;
  summaryText: string | undefined;
  rootPreviewText: string | undefined;
  messageCount: number;
  tags: string[];
};

export type AttentionState = 'needs-attention' | 'waiting' | 'streaming' | 'resolved' | 'idle';

export type VisibleThreadRootData = {
  ids: string[];
  indexMap: Map<string, number>;
  bodyMap: Map<string, string>;
};

// ─── Tri-state helpers ───────────────────────────────────────────────────────

export const cycleTriState = (state: TriState): TriState => {
  if (state === 'any') return 'include';
  if (state === 'include') return 'exclude';
  return 'any';
};

export const matchesTriState = (value: boolean, state: TriState): boolean => {
  if (state === 'any') return true;
  return state === 'include' ? value : !value;
};

export const dimensionMatchers: Record<
  ThreadFilterKey,
  (meta: ThreadOverviewMetadata) => boolean
> = {
  resolved: (meta) => meta.isResolved,
  streaming: (meta) => meta.isStreaming,
  scheduled: (meta) => meta.scheduledTaskCount > 0,
  unread: (meta) => meta.isUnread,
  idle: (meta) => !meta.isStreaming && meta.scheduledTaskCount === 0 && meta.isResolved,
};

export const matchesTagFilters = (
  threadTags: string[],
  tagFilters: Map<string, TriState>
): boolean => {
  for (const [tag, filterState] of tagFilters) {
    if (!matchesTriState(threadTags.includes(tag), filterState)) return false;
  }
  return true;
};

export const matchesThreadFilterState = (
  meta: ThreadOverviewMetadata,
  state: ThreadFilterState
): boolean => {
  const keys = Object.keys(dimensionMatchers) as ThreadFilterKey[];

  if (state.statusMode === 'or') {
    // Exclude filters are always hard rejections
    for (const key of keys) {
      if (state[key] === 'exclude' && dimensionMatchers[key](meta)) return false;
    }
    // Include filters: at least one must match (OR)
    const includeKeys = keys.filter((key) => state[key] === 'include');
    if (includeKeys.length > 0 && !includeKeys.some((key) => dimensionMatchers[key](meta))) {
      return false;
    }
  } else {
    // AND mode: every status filter must match
    for (const key of keys) {
      if (!matchesTriState(dimensionMatchers[key](meta), state[key])) return false;
    }
  }

  return matchesTagFilters(meta.tags, state.tags);
};

export const hasActiveThreadFilters = (state: ThreadFilterState): boolean =>
  (Object.keys(dimensionMatchers) as ThreadFilterKey[]).some((key) => state[key] !== 'any') ||
  state.tags.size > 0 ||
  (state.searchQuery ?? '').length > 0;

export const isDefaultThreadFilterState = (state: ThreadFilterState): boolean =>
  JSON.stringify(serializeThreadFilterState(state)) === DEFAULT_SERIALIZED_THREAD_FILTER_STATE;

export const isRoomThreadOverviewActive = (
  threadId: string | undefined,
  state: ThreadFilterState
): boolean => !threadId && (hasActiveThreadFilters(state) || state.sortBy !== 'natural');

export const updateThreadFilterKey = (
  state: ThreadFilterState,
  key: ThreadFilterKey
): ThreadFilterState => ({
  ...state,
  [key]: cycleTriState(state[key]),
  statusMode: 'and',
});

export const cycleSortMode = (
  state: ThreadFilterState
): Pick<ThreadFilterState, 'sortBy' | 'sortDirection'> => {
  if (state.sortBy === 'natural') return { sortBy: 'lastReply', sortDirection: 'desc' };
  if (state.sortDirection === 'desc') return { sortBy: 'lastReply', sortDirection: 'asc' };
  return { sortBy: 'natural', sortDirection: 'desc' };
};

export const createThreadSortControlSignature = ({
  state,
  searchQuery,
  viewMode,
}: {
  state: ThreadFilterState;
  searchQuery?: string;
  viewMode?: RoomViewMode;
}): string =>
  JSON.stringify({
    sortBy: state.sortBy,
    sortDirection: state.sortDirection,
    resolved: state.resolved,
    streaming: state.streaming,
    scheduled: state.scheduled,
    unread: state.unread,
    idle: state.idle,
    statusMode: state.statusMode,
    tags: [...state.tags.entries()].sort(([tagA], [tagB]) => tagA.localeCompare(tagB)),
    searchQuery: searchQuery ?? state.searchQuery ?? '',
    viewMode: viewMode ?? 'normal',
  });

export const applyFrozenThreadOrder = (
  frozenOrderedIds: string[],
  liveOrderedIds: string[]
): string[] => {
  const liveIdSet = new Set(liveOrderedIds);
  const resolvedOrderedIds = frozenOrderedIds.filter((id) => liveIdSet.has(id));
  const resolvedIdSet = new Set(resolvedOrderedIds);

  liveOrderedIds.forEach((id) => {
    if (!resolvedIdSet.has(id)) {
      resolvedOrderedIds.push(id);
    }
  });

  return resolvedOrderedIds;
};

export const resetThreadFilterState = (): ThreadFilterState =>
  createDefaultThreadFilterState();

// ─── Tag filter helpers ──────────────────────────────────────────────────────

export const cycleTagFilter = (
  state: ThreadFilterState,
  tagName: string
): ThreadFilterState => {
  const newTags = new Map(state.tags);
  const current = newTags.get(tagName) ?? 'any';
  const next = cycleTriState(current);
  if (next === 'any') {
    newTags.delete(tagName);
  } else {
    newTags.set(tagName, next);
  }
  return { ...state, tags: newTags };
};

export const addTagFilter = (
  state: ThreadFilterState,
  tagName: string
): ThreadFilterState => {
  if (state.tags.has(tagName)) return state;
  const newTags = new Map(state.tags);
  newTags.set(tagName, 'include');
  return { ...state, tags: newTags };
};

export const removeTagFilter = (
  state: ThreadFilterState,
  tagName: string
): ThreadFilterState => {
  if (!state.tags.has(tagName)) return state;
  const newTags = new Map(state.tags);
  newTags.delete(tagName);
  return { ...state, tags: newTags };
};

export const collectAvailableRoomTags = (
  tagsMap: Map<string, { tags: Record<string, unknown> | null }>
): string[] => {
  const tagSet = new Set<string>();
  tagsMap.forEach((state) => {
    if (state.tags) {
      Object.keys(state.tags).forEach((tag) => tagSet.add(tag));
    }
  });
  const sorted = [...tagSet];
  sorted.sort();
  return sorted;
};

// ─── Thread root visibility ─────────────────────────────────────────────────

const getThreadRootEvent = (room: Room, threadRootId: string): MatrixEvent | undefined =>
  room.findEventById(threadRootId) ?? room.getThread(threadRootId)?.rootEvent;

const getEventBodyPreviewText = (event: MatrixEvent | undefined): string | undefined => {
  const content =
    event && typeof event.getContent === 'function'
      ? (event.getContent() as Record<string, unknown> | null | undefined)
      : undefined;
  if (!content || typeof content !== 'object' || Array.isArray(content)) return undefined;

  const newContent = content['m.new_content'];
  const editedBody =
    newContent && typeof newContent === 'object' && !Array.isArray(newContent)
      ? (newContent as Record<string, unknown>).body
      : undefined;
  const body = editedBody ?? content.body;

  if (typeof body !== 'string') return undefined;

  const normalized = trimReplyFromBody(body).replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : undefined;
};

const isVisibleThreadRootEvent = (
  event: MatrixEvent,
  room: Room,
  threadResolutionMap: Map<string, { isResolved: boolean }>,
  threadReplyCountMap?: Map<string, number>
): boolean => {
  const eventId = event.getId();
  if (!eventId) return false;
  if (event.threadRootId && event.threadRootId !== eventId) return false;
  if (isNestedThreadReplyEvent(event)) return false;

  return (
    event.isThreadRoot ||
    !!room.getThread(eventId) ||
    threadResolutionMap.has(eventId) ||
    (threadReplyCountMap?.get(eventId) ?? 0) > 0 ||
    isZeroReplyStandaloneThreadRootEvent(event)
  );
};

// ─── Summary helpers ─────────────────────────────────────────────────────────

const getSdkThreadSummaryInfo = (
  room: Room,
  threadRootId: string
): MindroomThreadSummaryInfo | undefined => {
  const thread = room.getThread(threadRootId);
  return getLatestThreadSummaryInfoFromEventSources(thread?.events, thread?.timeline);
};

export const buildVisibleThreadRootData = (
  renderableEventEntries: Array<{ event: MatrixEvent; absoluteIndex: number }>,
  room: Room,
  threadResolutionMap: Map<string, { isResolved: boolean }>,
  threadReplyCountMap?: Map<string, number>
): VisibleThreadRootData => {
  const ids: string[] = [];
  const indexMap = new Map<string, number>();
  const bodyMap = new Map<string, string>();

  renderableEventEntries.forEach(({ event, absoluteIndex }) => {
    const eventId = event.getId();
    if (!eventId) return;
    if (!isVisibleThreadRootEvent(event, room, threadResolutionMap, threadReplyCountMap)) return;

    ids.push(eventId);
    indexMap.set(eventId, absoluteIndex);
    const body = event.getContent()?.body;
    if (typeof body === 'string') bodyMap.set(eventId, body);
  });

  return { ids, indexMap, bodyMap };
};

export const buildThreadOverviewSummaryMap = (
  room: Room,
  threadRootIds: string[],
  loadedSummaryMap: Map<string, MindroomThreadSummaryInfo>,
  cachedSummaryMap: Map<string, MindroomThreadSummaryInfo>
): Map<string, MindroomThreadSummaryInfo> => {
  const summaryMap = new Map<string, MindroomThreadSummaryInfo>();

  threadRootIds.forEach((threadRootId) => {
    const summaryInfo =
      getSdkThreadSummaryInfo(room, threadRootId) ??
      loadedSummaryMap.get(threadRootId) ??
      cachedSummaryMap.get(threadRootId);

    if (summaryInfo?.summaryText) {
      summaryMap.set(threadRootId, summaryInfo);
    }
  });

  return summaryMap;
};

export const getThreadRootPreviewText = (room: Room, threadRootId: string): string | undefined =>
  getCompactThreadRootBodyPreviewText(getThreadRootEvent(room, threadRootId), {
    eventId: threadRootId,
    room,
  }) ?? getEventBodyPreviewText(getThreadRootEvent(room, threadRootId));

// ─── Thread metadata helpers ─────────────────────────────────────────────────

const getPreferredThreadReplyEvents = (
  thread:
    | {
        events?: MatrixEvent[];
        timeline?: MatrixEvent[];
      }
    | null
    | undefined
): MatrixEvent[] => {
  if (thread?.events?.length) return thread.events;
  if (thread?.timeline?.length) return thread.timeline;
  return thread?.events ?? thread?.timeline ?? [];
};

const getThreadMessageCount = (
  thread:
    | {
        length?: number;
        events?: MatrixEvent[];
        timeline?: MatrixEvent[];
      }
    | null
    | undefined,
  fallbackMessageCount?: number
): number => {
  if (typeof thread?.length === 'number' && thread.length > 0) return thread.length;

  const replyEvents = getPreferredThreadReplyEvents(thread);
  if (replyEvents.length > 0) return replyEvents.length;
  if (typeof fallbackMessageCount === 'number' && fallbackMessageCount > 0) {
    return fallbackMessageCount;
  }

  return 0;
};

const getParticipantDisplayNameFromIds = (
  room: Room,
  participantIds: string[] | undefined,
  currentUserId: string
): string | undefined => {
  const senderId = participantIds?.find(
    (candidateId) => !!candidateId && candidateId !== currentUserId
  );
  return senderId ? room.getMember(senderId)?.name ?? senderId : undefined;
};

const getThreadNonUserParticipantDisplayName = (
  room: Room,
  thread:
    | {
        rootEvent?: MatrixEvent;
        events?: MatrixEvent[];
        timeline?: MatrixEvent[];
      }
    | null
    | undefined,
  currentUserId: string
): string | undefined => {
  const candidateEvents = [thread?.rootEvent, ...getPreferredThreadReplyEvents(thread)];
  const participantEvent = candidateEvents.find(
    (event) =>
      !!event &&
      typeof event.getSender === 'function' &&
      !!event.getSender() &&
      event.getSender() !== currentUserId
  );
  const senderId =
    participantEvent && typeof participantEvent.getSender === 'function'
      ? participantEvent.getSender()
      : undefined;
  return senderId ? room.getMember(senderId)?.name ?? senderId : undefined;
};

export const getThreadOverviewSummaryText = (
  metadata: ThreadOverviewMetadata
): string | undefined => metadata.summaryText ?? metadata.rootPreviewText;

// ─── Batch scheduled task helper ────────────────────────────────────────────

export const getRoomScheduledTaskCounts = (
  scheduledTaskEvents: MatrixEvent[]
): Map<string, number> => {
  const counts = new Map<string, number>();
  const now = new Date();

  scheduledTaskEvents.forEach((event) => {
    const parsedTask = parseScheduledTaskStateEvent(event);
    if (!parsedTask) return;
    if (parsedTask.status !== 'pending') return;
    if (parsedTask.newThread) return;
    if (!parsedTask.threadId) return;

    if (parsedTask.executeAt) {
      const executeAtDate = new Date(parsedTask.executeAt);
      if (executeAtDate <= now) return;
    }

    counts.set(parsedTask.threadId, (counts.get(parsedTask.threadId) ?? 0) + 1);
  });

  return counts;
};

// ─── Unread heuristic ───────────────────────────────────────────────────────

export const isThreadUnread = (
  room: Room,
  threadRootId: string,
  currentUserId: string,
  readUpToTs: number | undefined
): boolean => {
  const thread = room.getThread(threadRootId);
  if (!thread) return false;

  const replyEvents = thread.events ?? [];
  if (replyEvents.length === 0) return false;

  const latestReply = replyEvents[replyEvents.length - 1];
  if (latestReply.getSender() === currentUserId) return false;

  if (readUpToTs === undefined) return true;

  return latestReply.getTs() > readUpToTs;
};

// ─── Metadata builder ───────────────────────────────────────────────────────

export const buildThreadMetadataMap = (
  room: Room,
  threadRootIds: string[],
  threadResolutionMap: Map<string, { isResolved: boolean; tags: Record<string, unknown> | null }>,
  scheduledTaskCounts: Map<string, number>,
  threadReplyCountMap: Map<string, number>,
  threadParticipantMap: Map<string, string[]>,
  summaryMap: Map<string, MindroomThreadSummaryInfo>,
  currentUserId: string,
  readUpToTs: number | undefined,
  absoluteIndexMap: Map<string, number>,
  eventBodyFallbackMap?: Map<string, string>,
  cachedLastActivityTsMap?: Map<string, number>
): Map<string, ThreadOverviewMetadata> => {
  const metadataMap = new Map<string, ThreadOverviewMetadata>();

  threadRootIds.forEach((threadRootId) => {
    const thread = room.getThread(threadRootId);
    const rootEvent = getThreadRootEvent(room, threadRootId);
    const resolutionState = threadResolutionMap.get(threadRootId);
    const isResolved = resolutionState?.isResolved ?? false;
    const tags = resolutionState?.tags ? Object.keys(resolutionState.tags) : [];
    const isStreaming = getThreadStreamingState(room, threadRootId);
    const scheduledTaskCount = scheduledTaskCounts.get(threadRootId) ?? 0;
    const liveLastActivityTs = getThreadLastActivityTs(room, threadRootId) ?? 0;
    const cachedLastActivityTs = cachedLastActivityTsMap?.get(threadRootId) ?? 0;
    const rootEventTs = rootEvent?.getTs?.() ?? 0;
    const lastActivityTs = Math.max(liveLastActivityTs, cachedLastActivityTs, rootEventTs);
    const absoluteIndex = absoluteIndexMap.get(threadRootId) ?? 0;
    const unread = isThreadUnread(room, threadRootId, currentUserId, readUpToTs);
    const replyEvents = getPreferredThreadReplyEvents(thread);
    const fallbackParticipantIds = threadParticipantMap.get(threadRootId);
    const lastEvent = replyEvents[replyEvents.length - 1];
    const lastSenderId =
      lastEvent?.getSender() ??
      (fallbackParticipantIds && fallbackParticipantIds.length > 0
        ? fallbackParticipantIds[0]
        : undefined);
    const lastSenderDisplayName = lastSenderId
      ? room.getMember(lastSenderId)?.name ?? lastSenderId
      : undefined;
    const summaryInfo = summaryMap.get(threadRootId);
    const messageCount =
      summaryInfo?.messageCount ??
      getThreadMessageCount(thread, threadReplyCountMap.get(threadRootId));
    const participantDisplayName =
      getThreadNonUserParticipantDisplayName(room, thread, currentUserId) ??
      getParticipantDisplayNameFromIds(room, fallbackParticipantIds, currentUserId);

    metadataMap.set(threadRootId, {
      isResolved,
      isUnread: unread,
      isStreaming,
      scheduledTaskCount,
      lastActivityTs,
      absoluteIndex,
      lastSenderId,
      lastSenderDisplayName,
      participantDisplayName,
      summaryText: summaryInfo?.summaryText,
      rootPreviewText: pickPreferredThreadRootPreviewText({
        preferredPreviewText: eventBodyFallbackMap?.get(threadRootId),
        fallbackPreviewText: getCompactThreadRootBodyPreviewText(rootEvent, {
          eventId: threadRootId,
          room,
        }) ?? getEventBodyPreviewText(rootEvent),
      }),
      messageCount,
      tags,
    });
  });

  return metadataMap;
};

// ─── Attention state (compact view) ─────────────────────────────────────────

export const getAttentionState = (
  metadata: ThreadOverviewMetadata,
  currentUserId: string
): AttentionState => {
  if (metadata.isStreaming) return 'streaming';
  if (metadata.isResolved) return 'resolved';
  if (!metadata.lastSenderId) return 'idle';
  if (metadata.lastSenderId === currentUserId) return 'waiting';
  return 'needs-attention';
};

// ─── Status counts ─────────────────────────────────────────────────────────

export type StatusCounts = Record<ThreadFilterKey, number>;

export const computeStatusCounts = (
  threadRootIds: string[],
  metadataMap: Map<string, ThreadOverviewMetadata>
): StatusCounts => {
  const counts: StatusCounts = { resolved: 0, streaming: 0, scheduled: 0, unread: 0, idle: 0 };

  threadRootIds.forEach((id) => {
    const meta = metadataMap.get(id);
    if (!meta) return;
    for (const key of Object.keys(dimensionMatchers) as ThreadFilterKey[]) {
      if (dimensionMatchers[key](meta)) counts[key]++;
    }
  });

  return counts;
};

// ─── Filter (v2 tri-state) ───────────────────────────────────────────────────

export const filterThreadRootEvents = (
  threadRootEventIds: string[],
  state: ThreadFilterState,
  metadataMap: Map<string, ThreadOverviewMetadata>
): string[] => {
  if (!hasActiveThreadFilters(state)) return threadRootEventIds;

  return threadRootEventIds.filter((id) => {
    const meta = metadataMap.get(id);
    if (!meta) return false;
    return matchesThreadFilterState(meta, state);
  });
};

// ─── Sort (v2 direction-aware) ───────────────────────────────────────────────

const compareByLastActivityDesc = (
  a: ThreadOverviewMetadata,
  b: ThreadOverviewMetadata
): number => {
  const diff = b.lastActivityTs - a.lastActivityTs;
  return diff !== 0 ? diff : a.absoluteIndex - b.absoluteIndex;
};

const compareByLastActivityAsc = (
  a: ThreadOverviewMetadata,
  b: ThreadOverviewMetadata
): number => {
  const diff = a.lastActivityTs - b.lastActivityTs;
  return diff !== 0 ? diff : a.absoluteIndex - b.absoluteIndex;
};

export const sortThreadRootEvents = (
  threadRootEventIds: string[],
  sortBy: 'natural' | 'lastReply',
  sortDirection: 'asc' | 'desc',
  metadataMap: Map<string, ThreadOverviewMetadata>
): string[] => {
  if (sortBy === 'natural') return threadRootEventIds;

  const sorted = [...threadRootEventIds];
  const comparator = sortDirection === 'asc' ? compareByLastActivityAsc : compareByLastActivityDesc;

  sorted.sort((aId, bId) => {
    const a = metadataMap.get(aId);
    const b = metadataMap.get(bId);
    if (!a || !b) return 0;
    return comparator(a, b);
  });

  return sorted;
};

// ─── Filter presets ─────────────────────────────────────────────────────────

export type FilterPreset = {
  id: string;
  label: string;
  description: string;
  apply: Partial<Record<ThreadFilterKey, TriState>> & { statusMode?: 'and' | 'or' };
};

export const FILTER_PRESETS: FilterPreset[] = [
  {
    id: 'needs-attention',
    label: 'Needs attention',
    description: 'Unresolved, non-streaming, non-scheduled threads',
    apply: { resolved: 'exclude', streaming: 'exclude', scheduled: 'exclude' },
  },
  {
    id: 'active-work',
    label: 'Active work',
    description: 'Streaming or scheduled threads',
    apply: { streaming: 'include', scheduled: 'include', statusMode: 'or' },
  },
  {
    id: 'review-queue',
    label: 'Review queue',
    description: 'Unresolved threads with unread replies',
    apply: { resolved: 'exclude', unread: 'include' },
  },
  {
    id: 'archived',
    label: 'Archived',
    description: 'Resolved threads only',
    apply: { resolved: 'include' },
  },
  {
    id: 'all',
    label: 'All',
    description: 'Reset all filters',
    apply: {},
  },
];

export const applyPreset = (
  state: ThreadFilterState,
  preset: FilterPreset
): ThreadFilterState => {
  const { statusMode, ...statusOverrides } = preset.apply;
  return {
    ...state,
    resolved: 'any',
    streaming: 'any',
    scheduled: 'any',
    unread: 'any',
    idle: 'any',
    statusMode: statusMode ?? 'and',
    ...statusOverrides,
  };
};

// ─── Tag counts ─────────────────────────────────────────────────────────────

export const computeTagCounts = (
  threadRootIds: string[],
  metadataMap: Map<string, ThreadOverviewMetadata>
): Record<string, number> => {
  const counts: Record<string, number> = {};
  threadRootIds.forEach((id) => {
    const meta = metadataMap.get(id);
    if (!meta) return;
    meta.tags.forEach((tag) => {
      counts[tag] = (counts[tag] ?? 0) + 1;
    });
  });
  return counts;
};

// ─── Search filter ──────────────────────────────────────────────────────────

export const filterThreadsBySearch = (
  threadRootIds: string[],
  searchQuery: string | undefined,
  metadataMap: Map<string, ThreadOverviewMetadata>
): string[] => {
  const q = (searchQuery ?? '').trim().toLowerCase();
  if (!q) return threadRootIds;
  return threadRootIds.filter((id) => {
    const meta = metadataMap.get(id);
    if (!meta) return false;
    return (
      (meta.summaryText && meta.summaryText.toLowerCase().includes(q)) ||
      (meta.rootPreviewText && meta.rootPreviewText.toLowerCase().includes(q))
    );
  });
};
