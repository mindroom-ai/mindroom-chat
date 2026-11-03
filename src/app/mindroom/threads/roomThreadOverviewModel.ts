import type { RoomViewMode } from './roomViewMode';
import { applyParsedThreadFilterQuery, parseThreadFilterQuery } from './threadFilterDsl';

// ─── Tri-state types ─────────────────────────────────────────────────────────

export type TriState = 'any' | 'include' | 'exclude';

export type ThreadFilterKey = 'resolved' | 'streaming' | 'scheduled' | 'unread' | 'idle';
export const THREAD_FILTER_KEYS: ThreadFilterKey[] = [
  'resolved',
  'streaming',
  'scheduled',
  'unread',
  'idle',
];

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
  // Canonical search state. The visible DSL query is derived from the
  // structured filters plus these text fragments.
  freeText: string;
  unsupportedQuery: string;
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
  freeText: '',
  unsupportedQuery: '',
  statusMode: 'and',
});

export interface SerializedThreadFilterState {
  v: 2;
  resolved: TriState;
  streaming: TriState;
  scheduled: TriState;
  unread: TriState;
  idle: TriState;
  sortBy: ThreadFilterState['sortBy'];
  sortDirection: ThreadFilterState['sortDirection'];
  tags: Record<string, Exclude<TriState, 'any'>>;
  freeText?: string;
  unsupportedQuery?: string;
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
    sortBy === 'natural'
      ? 'desc'
      : isSortDirection(state.sortDirection)
      ? state.sortDirection
      : 'desc';
  const freeText = typeof state.freeText === 'string' ? state.freeText : '';
  const unsupportedQuery = typeof state.unsupportedQuery === 'string' ? state.unsupportedQuery : '';
  const statusMode = isStatusMode(state.statusMode) ? state.statusMode : 'and';

  const tags = Object.fromEntries(
    [...state.tags.entries()]
      .filter((entry): entry is [string, Exclude<TriState, 'any'>] => isStoredTagTriState(entry[1]))
      .sort(([tagA], [tagB]) => tagA.localeCompare(tagB))
  );

  return {
    v: 2,
    resolved: isTriState(state.resolved) ? state.resolved : 'any',
    streaming: isTriState(state.streaming) ? state.streaming : 'any',
    scheduled: isTriState(state.scheduled) ? state.scheduled : 'any',
    unread: isTriState(state.unread) ? state.unread : 'any',
    idle: isTriState(state.idle) ? state.idle : 'any',
    sortBy,
    sortDirection,
    tags,
    freeText,
    unsupportedQuery,
    statusMode,
  };
};

const DEFAULT_SERIALIZED_THREAD_FILTER_STATE = JSON.stringify(
  serializeThreadFilterState(createDefaultThreadFilterState())
);

export const deserializeThreadFilterState = (value: unknown): ThreadFilterState => {
  const defaultState = createDefaultThreadFilterState();

  if (!isRecord(value) || (value.v !== 1 && value.v !== 2)) {
    return defaultState;
  }

  const sortBy = isSortBy(value.sortBy) ? value.sortBy : defaultState.sortBy;
  const rawSortDirection = isSortDirection(value.sortDirection)
    ? value.sortDirection
    : defaultState.sortDirection;
  const sortDirection = sortBy === 'natural' ? 'desc' : rawSortDirection;
  const freeText = typeof value.freeText === 'string' ? value.freeText : defaultState.freeText;
  const unsupportedQuery =
    typeof value.unsupportedQuery === 'string'
      ? value.unsupportedQuery
      : defaultState.unsupportedQuery;
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

  const state: ThreadFilterState = {
    resolved: isTriState(value.resolved) ? value.resolved : defaultState.resolved,
    streaming: isTriState(value.streaming) ? value.streaming : defaultState.streaming,
    scheduled: isTriState(value.scheduled) ? value.scheduled : defaultState.scheduled,
    unread: isTriState(value.unread) ? value.unread : defaultState.unread,
    idle: isTriState(value.idle) ? value.idle : defaultState.idle,
    sortBy,
    sortDirection,
    tags,
    freeText,
    unsupportedQuery,
    statusMode,
  };

  // v1 stored both structured fields and a DSL string. Runtime behavior made
  // the DSL authoritative, so migrate it once at the persistence boundary and
  // store only canonical structured filters + text from then on.
  if (value.v === 1 && typeof value.searchQuery === 'string') {
    return applyParsedThreadFilterQuery(state, parseThreadFilterQuery(value.searchQuery));
  }
  return state;
};

export type VisibleThreadRootData = {
  ids: string[];
  indexMap: Map<string, number>;
  bodyMap: Map<string, string>;
};

// ─── Tri-state helpers ───────────────────────────────────────────────────────

export const matchesTriState = (value: boolean, state: TriState): boolean => {
  if (state === 'any') return true;
  return state === 'include' ? value : !value;
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

export const hasActiveThreadFilters = (state: ThreadFilterState): boolean =>
  THREAD_FILTER_KEYS.some((key) => state[key] !== 'any') ||
  state.tags.size > 0 ||
  (state.freeText ?? '').length > 0 ||
  (state.unsupportedQuery ?? '').length > 0;

export const isDefaultThreadFilterState = (state: ThreadFilterState): boolean =>
  JSON.stringify(serializeThreadFilterState(state)) === DEFAULT_SERIALIZED_THREAD_FILTER_STATE;

export const isRoomThreadOverviewActive = (
  threadId: string | undefined,
  state: ThreadFilterState
): boolean => !threadId && (hasActiveThreadFilters(state) || state.sortBy !== 'natural');

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
    searchQuery: searchQuery ?? state.freeText ?? '',
    viewMode: viewMode ?? 'threaded',
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

export const normalizeThreadSearchText = (query: string): string =>
  query.trim().split(/\s+/).filter(Boolean).join(' ');

// ─── Tag filter helpers ──────────────────────────────────────────────────────

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

// ─── Status counts ─────────────────────────────────────────────────────────

export type StatusCounts = Record<ThreadFilterKey, number>;
