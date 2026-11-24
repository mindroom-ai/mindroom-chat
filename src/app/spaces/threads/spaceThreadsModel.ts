import type { Room } from 'matrix-js-sdk';
import {
  buildCrossRoomThreadIndexEntry,
  getCrossRoomThreadIndexKey,
  normalizeThreadSearchText,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from '../../threads/cross-room/threadSignals';
import { buildCompactThreadSections } from '../../threads/overview/compactThreadSections';
import { isZeroReplyStandaloneThreadRootEvent } from '../../event-store/threads/compactThreadRootData';
import {
  selectThreadWorkflowTab,
  simplifyAgentlessSimpleThreadFilterState,
  simplifyAgentlessThreadFilterState,
  simplifyThreadFilterState,
  type StatusCounts,
  type ThreadFilterState,
} from '../../event-store/threads/roomThreadOverviewModel';
import { matchesThreadPeopleFilter } from '../../event-store/threads/threadPeopleFilter';
import {
  computeThreadRecordStatusCounts,
  computeThreadRecordTagCounts,
  computeThreadWorkflowCounts,
  filterThreadRecordRootIds,
} from '../../event-store/threads/threadRecordOverview';
import type {
  ThreadWorkflowBucket,
  ThreadWorkflowCounts,
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
  userId: string,
  ignoredUsers?: ReadonlySet<string>
): CrossRoomThreadIndexEntry[] => {
  const isIgnored = (senderId: string | undefined): boolean =>
    Boolean(senderId && ignoredUsers?.has(senderId));
  const entries: CrossRoomThreadIndexEntry[] = [];
  const seen = new Set<string>();
  indexed.forEach((entry) => {
    if (!roomIds.has(entry.roomId) || isIgnored(entry.rootSenderId)) return;
    entries.push(entry);
    seen.add(entry.key);
  });
  rooms.forEach((room) => {
    (room.getLiveTimeline?.()?.getEvents?.() ?? []).forEach((event) => {
      const eventId = event.getId?.();
      if (!eventId) return;
      const key = getCrossRoomThreadIndexKey(room.roomId, eventId);
      if (
        seen.has(key) ||
        isIgnored(event.getSender?.()) ||
        !isZeroReplyStandaloneThreadRootEvent(event)
      ) {
        return;
      }
      const entry = buildCrossRoomThreadIndexEntry({
        room,
        threadRootId: eventId,
        threadRootEvent: event,
        currentUserId: userId,
      });
      if (entry && !isIgnored(entry.rootSenderId)) {
        seen.add(key);
        entries.push(entry);
      }
    });
  });
  return entries;
};

/** Prunes room selection to currently visible rooms; returns undefined (= All) when empty or full. */
export const pruneSpaceRoomSelection = (
  selectedRoomIds: ReadonlySet<string> | undefined,
  allRoomIds: readonly string[]
): Set<string> | undefined => {
  if (!selectedRoomIds || selectedRoomIds.size === 0) return undefined;
  const valid = new Set(allRoomIds);
  const pruned = new Set<string>();
  selectedRoomIds.forEach((id) => {
    if (valid.has(id)) pruned.add(id);
  });
  return pruned.size === 0 || pruned.size === valid.size ? undefined : pruned;
};

/** Active room IDs for the room filter; undefined or empty means all rooms in the Space. */
export const resolveActiveSpaceRoomIds = (
  allRoomIds: readonly string[],
  selectedRoomIds: ReadonlySet<string> | undefined
): string[] => {
  const pruned = pruneSpaceRoomSelection(selectedRoomIds, allRoomIds);
  return pruned ? allRoomIds.filter((roomId) => pruned.has(roomId)) : [...allRoomIds];
};

/** Toggles a room in or out of selection; unchecking the last active room resets to All. */
export const toggleSpaceRoomSelection = (
  selectedRoomIds: ReadonlySet<string> | undefined,
  roomId: string,
  allRoomIds: readonly string[]
): Set<string> | undefined => {
  if (allRoomIds.length <= 1) return undefined;
  const active = new Set(resolveActiveSpaceRoomIds(allRoomIds, selectedRoomIds));
  if (active.has(roomId)) active.delete(roomId);
  else if (allRoomIds.includes(roomId)) active.add(roomId);
  return pruneSpaceRoomSelection(active, allRoomIds);
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
  simpleMode: boolean;
  snoozeNow: number;
  hasMindroomAgents: boolean;
  roomNameById: ReadonlyMap<string, string>;
  groupSections?: boolean;
  signalsOf?: (entry: CrossRoomThreadIndexEntry) => ThreadSignals | undefined;
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
  simpleMode: boolean,
  hasMindroomAgents: boolean
): ThreadFilterState => {
  if (simpleMode) {
    return hasMindroomAgents
      ? simplifyThreadFilterState(filterState)
      : simplifyAgentlessSimpleThreadFilterState(filterState);
  }
  if (!hasMindroomAgents) return simplifyAgentlessThreadFilterState(filterState);
  return filterState.tab ? selectThreadWorkflowTab(filterState, filterState.tab) : filterState;
};

/** Filters, counts, sorts, and optionally groups all threads belonging to a Matrix Space. */
export const filterAndSortSpaceThreads = ({
  entries,
  spaceRoomIds,
  selectedRoomIds,
  filterState,
  simpleMode,
  snoozeNow,
  hasMindroomAgents,
  roomNameById,
  groupSections = false,
  signalsOf,
}: FilterAndSortSpaceThreadsOptions): SpaceThreadsResult => {
  const roomCounts = new Map<string, number>();
  spaceRoomIds.forEach((roomId) => roomCounts.set(roomId, 0));

  const spaceEntries: CrossRoomThreadIndexEntry[] = [];
  for (const entry of entries) {
    if (!spaceRoomIds.has(entry.roomId)) continue;
    spaceEntries.push(entry);
    roomCounts.set(entry.roomId, (roomCounts.get(entry.roomId) ?? 0) + 1);
  }

  const roomSelection = pruneSpaceRoomSelection(selectedRoomIds, [...spaceRoomIds]);
  const scoped = roomSelection
    ? spaceEntries.filter((entry) => roomSelection.has(entry.roomId))
    : spaceEntries;

  // Re-key records by cross-room `entry.key` so shared single-room helpers cannot collide across rooms.
  const keyedRecordMap = new Map(
    scoped.map((entry) => [entry.key, { ...entry.threadRecord, threadRootId: entry.key }] as const)
  );
  const scopedKeys = scoped.map((entry) => entry.key);
  const statusCounts = computeThreadRecordStatusCounts(scopedKeys, keyedRecordMap, snoozeNow);
  const tagCounts = computeThreadRecordTagCounts(scopedKeys, keyedRecordMap);
  const availableTags = Object.keys(tagCounts).sort((a, b) => a.localeCompare(b));

  const effective = projectFilterState(filterState, simpleMode, hasMindroomAgents);
  const searchTokens = normalizeThreadSearchText(effective.freeText).split(' ').filter(Boolean);
  const prefiltered = scoped.filter((entry) => {
    const people = effective.people;
    if (
      people &&
      people.length > 0 &&
      !(entry.rootSenderId && people.includes(entry.rootSenderId)) &&
      !matchesThreadPeopleFilter(entry.threadRecord, people)
    ) {
      return false;
    }
    if (searchTokens.length > 0) {
      const roomName = roomNameById.get(entry.roomId) ?? entry.roomName;
      const haystack = normalizeThreadSearchText(`${entry.searchableText} ${roomName}`);
      if (!searchTokens.every((token) => haystack.includes(token))) return false;
    }
    return true;
  });

  const entryByKey = new Map(prefiltered.map((entry) => [entry.key, entry] as const));
  const prefilteredKeys = prefiltered.map((entry) => entry.key);
  const isForUser = (key: string) => entryByKey.get(key)?.isForUser ?? false;
  const recordFilter: ThreadFilterState = { ...effective, freeText: '', people: undefined };
  const bucketCounts = computeThreadWorkflowCounts(
    prefilteredKeys,
    keyedRecordMap,
    recordFilter,
    snoozeNow,
    isForUser
  );
  const filtered = filterThreadRecordRootIds(
    prefilteredKeys,
    recordFilter,
    keyedRecordMap,
    snoozeNow,
    isForUser
  )
    .map((key) => entryByKey.get(key))
    .filter((entry): entry is CrossRoomThreadIndexEntry => Boolean(entry));

  const direction = effective.sortDirection === 'asc' ? 1 : -1;
  filtered.sort(
    (a, b) => (a.lastActivityTs - b.lastActivityTs) * direction || a.key.localeCompare(b.key)
  );

  const sections: SpaceThreadSection[] = groupSections
    ? buildCompactThreadSections({
        threadRootIds: filtered.map((entry) => entry.key),
        recordMap: keyedRecordMap,
        entryOf: (key) => entryByKey.get(key),
        signalsOf: (entry) => signalsOf?.(entry),
        pinnedRootIds: [],
        now: snoozeNow,
      }).map((section) => ({
        id: section.id,
        entries: section.rootIds
          .map((key) => entryByKey.get(key))
          .filter((entry): entry is CrossRoomThreadIndexEntry => Boolean(entry)),
      }))
    : [];

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
  hasDraft,
}: ResolveComposerTargetRoomOptions): string | undefined => {
  const sendableSet = new Set(sendableRoomIds);
  if (hasDraft && currentTargetRoomId && sendableSet.has(currentTargetRoomId)) {
    return currentTargetRoomId;
  }
  const activeSendable = activeRoomIds.filter((roomId) => sendableSet.has(roomId));
  const candidates = activeSendable.length > 0 ? activeSendable : sendableRoomIds;
  if (candidates.length === 1) return candidates[0];
  if (currentTargetRoomId && candidates.includes(currentTargetRoomId)) {
    return currentTargetRoomId;
  }
  return candidates[0];
};
