import type { Room } from 'matrix-js-sdk';
import {
  buildCrossRoomThreadIndexEntry,
  getCrossRoomThreadIndexKey,
  normalizeThreadSearchText,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from '../../threads/cross-room/threadSignals';
import {
  buildCompactThreadSections,
  type CompactThreadSection,
} from '../../threads/overview/compactThreadSections';
import { isZeroReplyStandaloneThreadRootEvent } from '../../event-store/threads/compactThreadRootData';
import {
  projectThreadFilterState,
  type StatusCounts,
  type ThreadFilterState,
} from '../../event-store/threads/roomThreadOverviewModel';
import {
  computeThreadRecordStatusCounts,
  computeThreadRecordTagCounts,
  computeThreadWorkflowCounts,
  filterThreadRecordRootIds,
} from '../../event-store/threads/threadRecordOverview';
import type { ThreadWorkflowCounts } from '../../event-store/threads/threadWorkflow';
import type { ThreadRecord } from '../../event-store/threads/types';

export type SpaceRoomItem = {
  room: Room;
  name: string;
  accentColor: string;
};

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
  return ROOM_ACCENT_PALETTE[Math.abs(hash) % ROOM_ACCENT_PALETTE.length]!;
};

/** Collects indexed threads and standalone 0-reply roots from live timelines across a Space's rooms. */
export const collectSpaceThreadEntries = (
  indexed: ReadonlyMap<string, CrossRoomThreadIndexEntry>,
  rooms: readonly Room[],
  userId: string,
  ignoredUsers?: ReadonlySet<string>
): CrossRoomThreadIndexEntry[] => {
  const roomIds = new Set(rooms.map((room) => room.roomId));
  const isIgnored = (senderId: string | undefined): boolean =>
    Boolean(senderId && ignoredUsers?.has(senderId));
  const entries = new Map<string, CrossRoomThreadIndexEntry>();
  indexed.forEach((entry) => {
    if (!roomIds.has(entry.roomId) || isIgnored(entry.rootSenderId)) return;
    entries.set(entry.key, entry);
  });
  rooms.forEach((room) => {
    (room.getLiveTimeline?.()?.getEvents?.() ?? []).forEach((event) => {
      const eventId = event.getId?.();
      if (!eventId) return;
      const key = getCrossRoomThreadIndexKey(room.roomId, eventId);
      if (
        entries.has(key) ||
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
      if (entry) entries.set(key, entry);
    });
  });
  return [...entries.values()];
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

/**
 * Toggles a room in or out of selection (matching People/Tags dropdown semantics):
 * clicking a room while showing all rooms downselects to that 1 room; unchecking the
 * last chosen room or checking every room resets to undefined (all rooms).
 */
export const toggleSpaceRoomSelection = (
  selectedRoomIds: ReadonlySet<string> | undefined,
  roomId: string,
  allRoomIds: readonly string[]
): Set<string> | undefined => {
  const next = new Set(pruneSpaceRoomSelection(selectedRoomIds, allRoomIds));
  if (next.has(roomId)) next.delete(roomId);
  else next.add(roomId);
  return pruneSpaceRoomSelection(next, allRoomIds);
};

export type FilterAndSortSpaceThreadsOptions = {
  /** Entries already scoped to this Space's visible rooms. */
  entries: readonly CrossRoomThreadIndexEntry[];
  /** Insertion-ordered room catalog for every visible room in the Space. */
  roomsById: ReadonlyMap<string, Pick<SpaceRoomItem, 'name'>>;
  /** Already-pruned room selection (`undefined` means all rooms in the Space). */
  selectedRoomIds: ReadonlySet<string> | undefined;
  filterState: ThreadFilterState;
  simpleMode: boolean;
  snoozeNow: number;
  quietNow?: number;
  hasMindroomAgents: boolean;
  groupSections?: boolean;
  pinnedKeys?: readonly string[];
  signalsOf?: (entry: CrossRoomThreadIndexEntry) => ThreadSignals | undefined;
};

export type SpaceThreadsResult = {
  scopedTotalCount: number;
  roomCounts: Map<string, number>;
  entryByKey: ReadonlyMap<string, CrossRoomThreadIndexEntry>;
  scopedRecords: ReadonlyMap<string, ThreadRecord>;
  orderedKeys: string[];
  sections: CompactThreadSection[];
  nextQuietWakeTs?: number;
  bucketCounts: ThreadWorkflowCounts;
  statusCounts: StatusCounts;
  tagCounts: Record<string, number>;
  effectiveFilterState: ThreadFilterState;
};

/** Filters, counts, sorts, and optionally groups already-scoped threads belonging to a Matrix Space. */
export const filterAndSortSpaceThreads = ({
  entries,
  roomsById,
  selectedRoomIds,
  filterState,
  simpleMode,
  snoozeNow,
  quietNow = snoozeNow,
  hasMindroomAgents,
  groupSections = false,
  pinnedKeys = [],
  signalsOf,
}: FilterAndSortSpaceThreadsOptions): SpaceThreadsResult => {
  const roomCounts = new Map<string, number>();
  roomsById.forEach((_, roomId) => roomCounts.set(roomId, 0));
  entries.forEach((entry) => {
    roomCounts.set(entry.roomId, (roomCounts.get(entry.roomId) ?? 0) + 1);
  });

  const scoped = selectedRoomIds
    ? entries.filter((entry) => selectedRoomIds.has(entry.roomId))
    : entries;

  // Re-key records by cross-room `entry.key` so shared single-room helpers cannot collide across rooms.
  const entryByKey = new Map<string, CrossRoomThreadIndexEntry>();
  const keyedRecordMap = new Map<string, ThreadRecord>();
  const scopedKeys: string[] = [];
  scoped.forEach((entry) => {
    entryByKey.set(entry.key, entry);
    keyedRecordMap.set(entry.key, { ...entry.threadRecord, threadRootId: entry.key });
    scopedKeys.push(entry.key);
  });

  const statusCounts = computeThreadRecordStatusCounts(scopedKeys, keyedRecordMap, snoozeNow);
  const tagCounts = computeThreadRecordTagCounts(scopedKeys, keyedRecordMap);

  const effective: ThreadFilterState = {
    ...projectThreadFilterState(filterState, simpleMode, hasMindroomAgents),
    rooms: selectedRoomIds ? [...selectedRoomIds].sort() : undefined,
  };
  const searchTokens = normalizeThreadSearchText(effective.freeText).split(' ').filter(Boolean);
  const searchMatchedKeys =
    searchTokens.length > 0
      ? scopedKeys.filter((key) => {
          const entry = entryByKey.get(key)!;
          const roomName = roomsById.get(entry.roomId)?.name ?? entry.roomName;
          const haystack = normalizeThreadSearchText(`${entry.searchableText} ${roomName}`);
          return searchTokens.every((token) => haystack.includes(token));
        })
      : scopedKeys;

  const isForUser = (key: string) => entryByKey.get(key)?.isForUser ?? false;
  const recordFilter: ThreadFilterState = { ...effective, freeText: '' };
  const bucketCounts = computeThreadWorkflowCounts(
    searchMatchedKeys,
    keyedRecordMap,
    recordFilter,
    snoozeNow,
    isForUser
  );
  const orderedKeys = [
    ...filterThreadRecordRootIds(
      searchMatchedKeys,
      recordFilter,
      keyedRecordMap,
      snoozeNow,
      isForUser
    ),
  ];

  const direction = effective.sortDirection === 'asc' ? 1 : -1;
  orderedKeys.sort((aKey, bKey) => {
    const a = entryByKey.get(aKey)!;
    const b = entryByKey.get(bKey)!;
    return (a.lastActivityTs - b.lastActivityTs) * direction || aKey.localeCompare(bKey);
  });

  const grouped = groupSections
    ? buildCompactThreadSections({
        threadRootIds: orderedKeys,
        recordMap: keyedRecordMap,
        entryOf: (key) => entryByKey.get(key),
        signalsOf: (entry) => signalsOf?.(entry),
        pinnedRootIds: pinnedKeys,
        now: snoozeNow,
        quietNow,
      })
    : undefined;

  return {
    scopedTotalCount: scoped.length,
    roomCounts,
    entryByKey,
    scopedRecords: keyedRecordMap,
    orderedKeys,
    sections: grouped?.sections ?? [],
    nextQuietWakeTs: grouped?.nextQuietWakeTs,
    bucketCounts,
    statusCounts,
    tagCounts,
    effectiveFilterState: effective,
  };
};

export type ResolveComposerTargetRoomOptions = {
  activeRoomIds: readonly string[];
  sendableRoomIds: readonly string[];
  currentTargetRoomId?: string;
  hasDraft: boolean;
};

export type ComposerTargetResolution = {
  targetRoomId: string | undefined;
  destinationRoomIds: string[];
};

/**
 * Resolves the destination room and eligible destination list for the Space bottom composer.
 * Draft safety invariant: while `hasDraft` is true and `currentTargetRoomId` is sendable,
 * keep `currentTargetRoomId` (and include it in `destinationRoomIds`) even when room filters change.
 */
export const resolveComposerTargetRoom = ({
  activeRoomIds,
  sendableRoomIds,
  currentTargetRoomId,
  hasDraft,
}: ResolveComposerTargetRoomOptions): ComposerTargetResolution => {
  const sendableSet = new Set(sendableRoomIds);
  const activeSendable = activeRoomIds.filter((roomId) => sendableSet.has(roomId));
  const baseDestinations = activeSendable.length > 0 ? activeSendable : [...sendableRoomIds];

  if (hasDraft && currentTargetRoomId && sendableSet.has(currentTargetRoomId)) {
    const destinationRoomIds = baseDestinations.includes(currentTargetRoomId)
      ? baseDestinations
      : [currentTargetRoomId, ...baseDestinations];
    return { targetRoomId: currentTargetRoomId, destinationRoomIds };
  }

  const targetRoomId =
    currentTargetRoomId && baseDestinations.includes(currentTargetRoomId)
      ? currentTargetRoomId
      : baseDestinations[0];
  return { targetRoomId, destinationRoomIds: baseDestinations };
};
