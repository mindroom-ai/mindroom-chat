import { THREAD_WORKFLOW_TABS, type ThreadWorkflowTab } from './threadWorkflow';
import type { RoomViewMode } from '../../navigation/roomViewMode';
import { applyParsedThreadFilterQuery, parseThreadFilterQuery } from './threadFilterDsl';

// ─── Tri-state types ─────────────────────────────────────────────────────────

export type TriState = 'any' | 'include' | 'exclude';

export type ThreadFilterKey =
  'resolved' | 'snoozed' | 'streaming' | 'scheduled' | 'unread' | 'idle';
export const THREAD_FILTER_KEYS: ThreadFilterKey[] = [
  'resolved',
  'snoozed',
  'streaming',
  'scheduled',
  'unread',
  'idle',
];

export interface ThreadFilterState {
  /** Absent on legacy states. Selecting a tab clears the legacy status dimensions. */
  tab?: ThreadWorkflowTab;
  // Status toggles
  resolved: TriState;
  snoozed: TriState;
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
  // People filter (user IDs): a thread matches when any of them took part. Absent or empty: all.
  people?: string[];
  // Room filter (room IDs) for Space thread overviews. Absent or empty: all rooms.
  rooms?: string[];
  /** Only threads for this account. Absent on older filters and presets, meaning off. */
  forMe?: boolean;
}

export type ThreadSortFreezeState = {
  controlSignature: string | null;
  orderedRootIds: string[];
};

const DEFAULT_THREAD_FILTER_FOR_ME = false;

export const createDefaultThreadFilterState = (): ThreadFilterState => ({
  resolved: 'any',
  snoozed: 'any',
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
  forMe: DEFAULT_THREAD_FILTER_FOR_ME,
});

export interface SerializedThreadFilterState {
  tab?: ThreadWorkflowTab;
  v: 2;
  resolved: TriState;
  snoozed: TriState;
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
  people?: string[];
  rooms?: string[];
  forMe?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isTriState = (value: unknown): value is TriState =>
  value === 'any' || value === 'include' || value === 'exclude';

// A filter state stored before snoozing existed has no snoozed key; it hides snoozed threads.
const storedSnoozed = (value: unknown): TriState => (isTriState(value) ? value : 'exclude');

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
  const people = [...new Set(state.people ?? [])].sort();
  const rooms = [...new Set(state.rooms ?? [])].sort();

  const tags = Object.fromEntries(
    [...state.tags.entries()]
      .filter((entry): entry is [string, Exclude<TriState, 'any'>] => isStoredTagTriState(entry[1]))
      .sort(([tagA], [tagB]) => tagA.localeCompare(tagB))
  );

  return {
    v: 2,
    ...(state.tab ? { tab: state.tab } : {}),
    resolved: isTriState(state.resolved) ? state.resolved : 'any',
    snoozed: storedSnoozed(state.snoozed),
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
    ...(people.length > 0 ? { people } : {}),
    ...(rooms.length > 0 ? { rooms } : {}),
    ...(typeof state.forMe === 'boolean' ? { forMe: state.forMe } : {}),
  };
};

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
  const people = Array.isArray(value.people)
    ? value.people.filter((userId): userId is string => typeof userId === 'string')
    : [];
  const rooms = Array.isArray(value.rooms)
    ? [
        ...new Set(value.rooms.filter((roomId): roomId is string => typeof roomId === 'string')),
      ].sort()
    : [];

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
    ...(THREAD_WORKFLOW_TABS.includes(value.tab as ThreadWorkflowTab)
      ? { tab: value.tab as ThreadWorkflowTab }
      : {}),
    resolved: isTriState(value.resolved) ? value.resolved : defaultState.resolved,
    snoozed: storedSnoozed(value.snoozed),
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
    ...(people.length > 0 ? { people } : {}),
    ...(rooms.length > 0 ? { rooms } : {}),
    ...(typeof value.forMe === 'boolean' ? { forMe: value.forMe } : {}),
  };

  // v1 stored both structured fields and a DSL string. Runtime behavior made
  // the DSL authoritative, so migrate it once at the persistence boundary and
  // store only canonical structured filters + text from then on.
  if (value.v === 1 && typeof value.searchQuery === 'string') {
    const parsed = parseThreadFilterQuery(value.searchQuery);
    const migrated = applyParsedThreadFilterQuery(state, parsed);
    return parsed.status.snoozed ? migrated : { ...migrated, snoozed: state.snoozed };
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

export const isOrModeStatusChip = (state: ThreadFilterState, key: ThreadFilterKey): boolean =>
  state.statusMode === 'or' && state[key] === 'include';

export const hasActiveThreadFilters = (state: ThreadFilterState): boolean =>
  (state.tab !== undefined && state.tab !== 'all') ||
  THREAD_FILTER_KEYS.some((key) => state[key] !== 'any') ||
  state.tags.size > 0 ||
  (state.freeText ?? '').length > 0 ||
  (state.unsupportedQuery ?? '').length > 0 ||
  (state.people?.length ?? 0) > 0 ||
  state.forMe === true;

/**
 * Whether the reader chose a filter. Hiding snoozed threads is what Compact's default and every
 * state stored before snoozing existed read as, so it alone does not count.
 */
export const hasChosenThreadFilters = (state: ThreadFilterState): boolean =>
  hasActiveThreadFilters(state.snoozed === 'exclude' ? { ...state, snoozed: 'any' } : state);

/**
 * Whether the search query filters by something no other toolbar control shows: free text, a term
 * the parser keeps unsupported, or a status. Tags, people and the workflow tab have their own
 * controls, and hiding snoozed threads alone is the default (see hasChosenThreadFilters).
 */
export const hasSearchOnlyThreadFilters = (state: ThreadFilterState): boolean =>
  (state.freeText ?? '').length > 0 ||
  (state.unsupportedQuery ?? '').length > 0 ||
  THREAD_FILTER_KEYS.some(
    (key) => state[key] !== 'any' && !(key === 'snoozed' && state[key] === 'exclude')
  );

export const isRoomThreadOverviewActive = (
  threadId: string | undefined,
  state: ThreadFilterState
): boolean => !threadId && (hasChosenThreadFilters(state) || state.sortBy !== 'natural');

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
    tab: state.tab,
    sortBy: state.sortBy,
    sortDirection: state.sortDirection,
    resolved: state.resolved,
    snoozed: state.snoozed,
    streaming: state.streaming,
    scheduled: state.scheduled,
    unread: state.unread,
    idle: state.idle,
    statusMode: state.statusMode,
    tags: [...state.tags.entries()].sort(([tagA], [tagB]) => tagA.localeCompare(tagB)),
    searchQuery: searchQuery ?? state.freeText ?? '',
    viewMode: viewMode ?? 'threaded',
    ...(state.people?.length ? { people: state.people } : {}),
    ...(state.forMe ? { forMe: true } : {}),
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

export const resetThreadFilterState = (): ThreadFilterState => ({
  ...createDefaultThreadFilterState(),
  forMe: false,
});

export const normalizeThreadSearchText = (query: string): string =>
  query.trim().split(/\s+/).filter(Boolean).join(' ');

// ─── Simple mode ─────────────────────────────────────────────────────────────

/**
 * Project a persisted filter state onto the subspace reachable in simple
 * mode: defaults everywhere except sorting, For me, and the resolved and snoozed
 * dimensions, of which only 'exclude' survives ("unresolved only", and the
 * snoozed threads Compact hides). Controls for the other dimensions are
 * hidden in simple mode, so their persisted values must not
 * keep influencing which threads are shown. The stored state itself is left
 * untouched — leaving simple mode restores the full setup.
 *
 * The query shown by the UI is derived from this canonical projection, so no
 * second DSL representation needs to be kept in sync.
 */
export const simplifyThreadFilterState = (state: ThreadFilterState): ThreadFilterState => {
  return {
    ...createDefaultThreadFilterState(),
    resolved: state.resolved === 'exclude' ? 'exclude' : 'any',
    snoozed: state.snoozed === 'exclude' ? 'exclude' : 'any',
    forMe: state.forMe,
    sortBy: state.sortBy,
    sortDirection: state.sortDirection,
    ...(state.rooms?.length ? { rooms: state.rooms } : {}),
  };
};

/**
 * Agentless Simple Mode exposes sorting but not the agent-specific unresolved
 * filter. Keep For me and the sort choice while leaving hidden filters inactive.
 */
export const simplifyAgentlessSimpleThreadFilterState = (
  state: ThreadFilterState
): ThreadFilterState => ({
  ...simplifyThreadFilterState(state),
  resolved: 'any',
  snoozed: 'any',
});

/**
 * Project a persisted filter state onto the controls that remain available in
 * an agentless room. Agent status and tag filters must not keep affecting the
 * thread list after their controls disappear, while ordinary text search and
 * sorting remain usable. The stored state is left untouched so adding an agent
 * restores the room's previous agent-workflow setup.
 */
export const simplifyAgentlessThreadFilterState = (
  state: ThreadFilterState
): ThreadFilterState => ({
  ...createDefaultThreadFilterState(),
  sortBy: state.sortBy,
  sortDirection: state.sortDirection,
  freeText: state.freeText,
  unsupportedQuery: state.unsupportedQuery,
  people: state.people,
  forMe: state.forMe,
  ...(state.rooms?.length ? { rooms: state.rooms } : {}),
});

// ─── Tag filter helpers ──────────────────────────────────────────────────────

export const addTagFilter = (state: ThreadFilterState, tagName: string): ThreadFilterState => {
  if (state.tags.has(tagName)) return state;
  const newTags = new Map(state.tags);
  newTags.set(tagName, 'include');
  return { ...state, tags: newTags };
};

export const removeTagFilter = (state: ThreadFilterState, tagName: string): ThreadFilterState => {
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

// ─── Status counts ─────────────────────────────────────────────────────────

export type StatusCounts = Record<ThreadFilterKey, number>;

/** Keep people, tags, text and sort, but replace every legacy status restriction. */
export const selectThreadWorkflowTab = (
  state: ThreadFilterState,
  tab: ThreadWorkflowTab
): ThreadFilterState => ({
  ...state,
  tab,
  resolved: 'any',
  snoozed: 'any',
  streaming: 'any',
  scheduled: 'any',
  unread: 'any',
  idle: 'any',
  statusMode: 'and',
});

/**
 * Project a persisted filter state onto the controls that are currently visible.
 * Persisted advanced filters remain stored so they can be restored when those controls
 * become available again.
 */
export const projectThreadFilterState = (
  state: ThreadFilterState,
  simpleMode: boolean,
  hasMindroomAgents: boolean
): ThreadFilterState => {
  if (simpleMode) {
    return hasMindroomAgents
      ? simplifyThreadFilterState(state)
      : simplifyAgentlessSimpleThreadFilterState(state);
  }
  if (!hasMindroomAgents) return simplifyAgentlessThreadFilterState(state);
  return state.tab ? selectThreadWorkflowTab(state, state.tab) : state;
};

/** Applies a raw search query string, parsing DSL tokens only when agent controls are shown. */
export const applyThreadSearchQuery = (
  state: ThreadFilterState,
  query: string,
  hasMindroomAgents: boolean
): ThreadFilterState =>
  hasMindroomAgents
    ? applyParsedThreadFilterQuery(state, parseThreadFilterQuery(query))
    : {
        ...state,
        // With agent controls hidden, the retained search field is plain
        // text. Preserve agent filters in storage and treat is:/tag: tokens
        // literally instead of mutating invisible filter dimensions.
        freeText: normalizeThreadSearchText(query),
        unsupportedQuery: '',
      };

/** Whether the overview toolbar shows its "no threads match" empty banner with Reset action. */
export const showsFilteredEmptyState = (
  threadCount: number,
  totalThreadCount: number,
  state: ThreadFilterState
): boolean => threadCount === 0 && totalThreadCount > 0 && hasActiveThreadFilters(state);
