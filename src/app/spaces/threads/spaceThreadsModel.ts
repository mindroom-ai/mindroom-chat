import type { Room } from 'matrix-js-sdk';
import {
  buildCrossRoomThreadIndexEntry,
  getCrossRoomThreadIndexKey,
  normalizeThreadSearchText,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';
import { COMPACT_THREAD_SECTION_ORDER } from '../../threads/overview/compactThreadSections';
import { isZeroReplyStandaloneThreadRootEvent } from '../../event-store/threads/compactThreadRootData';
import {
  selectThreadWorkflowTab,
  simplifyAgentlessSimpleThreadFilterState,
  simplifyAgentlessThreadFilterState,
  simplifyThreadFilterState,
  type StatusCounts,
  type ThreadFilterState,
} from '../../event-store/threads/roomThreadOverviewModel';
import {
  applyParsedThreadFilterQuery,
  parseThreadFilterQuery,
} from '../../event-store/threads/threadFilterDsl';
import { matchesThreadPeopleFilter } from '../../event-store/threads/threadPeopleFilter';
import {
  computeThreadRecordStatusCounts,
  computeThreadRecordTagCounts,
  matchesThreadRecordFilterState,
} from '../../event-store/threads/threadRecordOverview';
import {
  classifyThreadWorkflow,
  threadReturnTs,
  type ThreadWorkflowBucket,
  type ThreadWorkflowCounts,
} from '../../event-store/threads/threadWorkflow';

const ROOM_ACCENT_PALETTE = [
  '#4f8ff7',
  '#2aa89b',
  '#3ba66b',
  '#d99026',
  '#e06b50',
  '#d95f8c',
  '#916be0',
  '#6675e6',
] as const;

/** Deterministic accessible accent color for a room ID (legible in dark and light themes). */
export const getRoomAccentColor = (roomId: string): string => {
  let hash = 0;
  for (let i = 0; i < roomId.length; i += 1)
    hash = (Math.imul(31, hash) + roomId.charCodeAt(i)) | 0;
  return ROOM_ACCENT_PALETTE[Math.abs(hash) % ROOM_ACCENT_PALETTE.length] ?? ROOM_ACCENT_PALETTE[0];
};

/** Collects indexed threads and standalone 0-reply roots from live timelines across a Space's rooms. */
export const collectSpaceThreadEntries = (
  indexed: ReadonlyMap<string, CrossRoomThreadIndexEntry>,
  rooms: readonly Room[],
  roomIds: ReadonlySet<string>,
  userId: string
): CrossRoomThreadIndexEntry[] => {
  const entries: CrossRoomThreadIndexEntry[] = [];
  const seen = new Set<string>();
  indexed.forEach((entry) => {
    if (!roomIds.has(entry.roomId)) return;
    entries.push(entry);
    seen.add(entry.key);
  });
  rooms.forEach((room) => {
    (room.getLiveTimeline?.()?.getEvents?.() ?? []).forEach((event) => {
      const eventId = event.getId?.();
      if (!eventId) return;
      const key = getCrossRoomThreadIndexKey(room.roomId, eventId);
      if (seen.has(key) || !isZeroReplyStandaloneThreadRootEvent(event)) return;
      const entry = buildCrossRoomThreadIndexEntry({
        room,
        threadRootId: eventId,
        threadRootEvent: event,
        currentUserId: userId,
      });
      if (entry) {
        seen.add(key);
        entries.push(entry);
      }
    });
  });
  return entries;
};

/** Active room IDs for the room filter; undefined or empty means all rooms in the Space. */
export const resolveActiveSpaceRoomIds = (
  allRoomIds: readonly string[],
  selectedRoomIds: ReadonlySet<string> | undefined
): string[] => {
  if (!selectedRoomIds || selectedRoomIds.size === 0) return [...allRoomIds];
  const filtered = allRoomIds.filter((roomId) => selectedRoomIds.has(roomId));
  return filtered.length > 0 ? filtered : [...allRoomIds];
};

/** Toggles a room in or out of selection; unchecking the last active room resets to All. */
export const toggleSpaceRoomSelection = (
  selectedRoomIds: ReadonlySet<string> | undefined,
  roomId: string,
  allRoomIds: readonly string[]
): Set<string> | undefined => {
  if (allRoomIds.length <= 1) return undefined;
  const active = new Set(resolveActiveSpaceRoomIds(allRoomIds, selectedRoomIds));
  if (active.has(roomId)) {
    active.delete(roomId);
    return active.size === 0 ? undefined : active;
  }
  if (allRoomIds.includes(roomId)) active.add(roomId);
  return allRoomIds.every((id) => active.has(id)) ? undefined : active;
};

/** Downselects to 1 room (`undefined` when the Space only has 1 room). */
export const selectOnlySpaceRoom = (
  roomId: string,
  allRoomIds: readonly string[]
): Set<string> | undefined => (allRoomIds.length <= 1 ? undefined : new Set([roomId]));

export type FilterAndSortSpaceThreadsOptions = {
  entries: Iterable<CrossRoomThreadIndexEntry>;
  spaceRoomIds: ReadonlySet<string>;
  selectedRoomIds: ReadonlySet<string> | undefined;
  filterState: ThreadFilterState;
  searchQuery?: string;
  simpleMode: boolean;
  snoozeNow: number;
  hasMindroomAgents: boolean;
  roomNameById: ReadonlyMap<string, string>;
  groupSections?: boolean;
};

export type SpaceThreadSection = { id: ThreadWorkflowBucket; entries: CrossRoomThreadIndexEntry[] };

export type SpaceThreadsResult = {
  scopedTotalCount: number;
  roomCounts: Map<string, number>;
  entries: CrossRoomThreadIndexEntry[];
  sections: SpaceThreadSection[];
  bucketCounts: ThreadWorkflowCounts;
  statusCounts: StatusCounts;
  tagCounts: Record<string, number>;
  availableTags: string[];
  effectiveFilterState: ThreadFilterState;
};

const projectFilterState = (
  filterState: ThreadFilterState,
  searchQuery: string | undefined,
  simpleMode: boolean,
  hasMindroomAgents: boolean
): ThreadFilterState => {
  const withQuery =
    searchQuery === undefined
      ? filterState
      : hasMindroomAgents
      ? applyParsedThreadFilterQuery(filterState, parseThreadFilterQuery(searchQuery))
      : { ...filterState, freeText: searchQuery, unsupportedQuery: '' };
  if (simpleMode) {
    return hasMindroomAgents
      ? simplifyThreadFilterState(withQuery)
      : simplifyAgentlessSimpleThreadFilterState(withQuery);
  }
  return hasMindroomAgents ? withQuery : simplifyAgentlessThreadFilterState(withQuery);
};

/** Filters, counts, sorts, and optionally groups all threads belonging to a Matrix Space. */
export const filterAndSortSpaceThreads = ({
  entries,
  spaceRoomIds,
  selectedRoomIds,
  filterState,
  searchQuery,
  simpleMode,
  snoozeNow,
  hasMindroomAgents,
  roomNameById,
  groupSections = false,
}: FilterAndSortSpaceThreadsOptions): SpaceThreadsResult => {
  const roomCounts = new Map<string, number>();
  spaceRoomIds.forEach((roomId) => roomCounts.set(roomId, 0));

  const spaceEntries: CrossRoomThreadIndexEntry[] = [];
  for (const entry of entries) {
    if (!spaceRoomIds.has(entry.roomId)) continue;
    spaceEntries.push(entry);
    roomCounts.set(entry.roomId, (roomCounts.get(entry.roomId) ?? 0) + 1);
  }

  const roomSelection =
    selectedRoomIds && selectedRoomIds.size > 0
      ? new Set([...selectedRoomIds].filter((roomId) => spaceRoomIds.has(roomId)))
      : undefined;
  const scoped =
    roomSelection && roomSelection.size > 0
      ? spaceEntries.filter((entry) => roomSelection.has(entry.roomId))
      : spaceEntries;

  const recordMap = new Map(scoped.map((entry) => [entry.key, entry.threadRecord] as const));
  const scopedKeys = scoped.map((entry) => entry.key);
  const statusCounts = computeThreadRecordStatusCounts(scopedKeys, recordMap, snoozeNow);
  const tagCounts = computeThreadRecordTagCounts(scopedKeys, recordMap);
  const availableTags = Object.keys(tagCounts).sort((a, b) => a.localeCompare(b));

  const effective = projectFilterState(filterState, searchQuery, simpleMode, hasMindroomAgents);
  const searchTokens = normalizeThreadSearchText(effective.freeText).split(' ').filter(Boolean);
  const tabNeutral: ThreadFilterState = {
    ...selectThreadWorkflowTab(effective, 'all'),
    people: undefined,
  };
  const recordFilter: ThreadFilterState = { ...effective, people: undefined };
  const bucketCounts: ThreadWorkflowCounts = { needsYou: 0, working: 0, later: 0, done: 0, all: 0 };
  const filtered: CrossRoomThreadIndexEntry[] = [];

  for (const entry of scoped) {
    const people = effective.people;
    if (
      people &&
      people.length > 0 &&
      !(entry.rootSenderId && people.includes(entry.rootSenderId)) &&
      !matchesThreadPeopleFilter(entry.threadRecord, people)
    ) {
      continue;
    }
    if (searchTokens.length > 0) {
      const roomName = roomNameById.get(entry.roomId) ?? entry.roomName;
      const haystack = normalizeThreadSearchText(`${entry.searchableText} ${roomName}`);
      if (!searchTokens.every((token) => haystack.includes(token))) continue;
    }
    const isForUser = () => entry.isForUser;
    if (matchesThreadRecordFilterState(entry.threadRecord, tabNeutral, snoozeNow, isForUser)) {
      bucketCounts[classifyThreadWorkflow(entry.threadRecord.status, snoozeNow)] += 1;
      bucketCounts.all += 1;
    }
    if (matchesThreadRecordFilterState(entry.threadRecord, recordFilter, snoozeNow, isForUser)) {
      filtered.push(entry);
    }
  }

  const direction = effective.sortDirection === 'asc' ? 1 : -1;
  const compareActivity = (a: CrossRoomThreadIndexEntry, b: CrossRoomThreadIndexEntry) =>
    (a.lastActivityTs - b.lastActivityTs) * direction || a.key.localeCompare(b.key);
  filtered.sort(compareActivity);

  const sections: SpaceThreadSection[] = [];
  if (groupSections) {
    const grouped: Record<ThreadWorkflowBucket, CrossRoomThreadIndexEntry[]> = {
      needsYou: [],
      working: [],
      later: [],
      done: [],
    };
    filtered.forEach((entry) =>
      grouped[classifyThreadWorkflow(entry.threadRecord.status, snoozeNow)].push(entry)
    );
    grouped.later.sort(
      (a, b) =>
        threadReturnTs(a.threadRecord.status, snoozeNow) -
          threadReturnTs(b.threadRecord.status, snoozeNow) || compareActivity(a, b)
    );
    COMPACT_THREAD_SECTION_ORDER.forEach((id) => {
      if (grouped[id].length > 0) sections.push({ id, entries: grouped[id] });
    });
  }

  return {
    scopedTotalCount: scoped.length,
    roomCounts,
    entries: filtered,
    sections,
    bucketCounts,
    statusCounts,
    tagCounts,
    availableTags,
    effectiveFilterState: effective,
  };
};

export type ResolveComposerTargetRoomOptions = {
  activeRoomIds: readonly string[];
  sendableRoomIds: readonly string[];
  currentTargetRoomId?: string;
  lastTargetRoomId?: string;
  hasDraft: boolean;
};

/**
 * Resolves the destination room for the Space bottom composer.
 * Draft safety invariant: while `hasDraft` is true and `currentTargetRoomId` is sendable,
 * keep `currentTargetRoomId` even when room filters change.
 */
export const resolveComposerTargetRoom = ({
  activeRoomIds,
  sendableRoomIds,
  currentTargetRoomId,
  lastTargetRoomId,
  hasDraft,
}: ResolveComposerTargetRoomOptions): string | undefined => {
  const sendableSet = new Set(sendableRoomIds);
  if (hasDraft && currentTargetRoomId && sendableSet.has(currentTargetRoomId)) {
    return currentTargetRoomId;
  }
  const activeSendable = activeRoomIds.filter((roomId) => sendableSet.has(roomId));
  if (activeSendable.length === 1) return activeSendable[0];
  if (currentTargetRoomId && activeSendable.includes(currentTargetRoomId)) {
    return currentTargetRoomId;
  }
  if (lastTargetRoomId && activeSendable.includes(lastTargetRoomId)) return lastTargetRoomId;
  return activeSendable[0] ?? sendableRoomIds[0];
};
