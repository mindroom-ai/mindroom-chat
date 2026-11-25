import type { MatrixClient, Room } from 'matrix-js-sdk';
import { sortRoomIdsByName } from '../../lib/nameOrder';
import { isSpace } from '../../matrix/room';
import { getJoinedSubspaces } from '../../matrix/state/useSpaceSearchRooms';
import type { RoomToParents } from '../../matrix/types/room';
import { getSpaceRoomSections } from '../spaceRoomSections';
import { revealDirectionControls } from '../../ui/directional';
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

/**
 * Toggles a subspace group of rooms: if every room in `groupRoomIds` is already selected, removes
 * them; otherwise adds them all. Empty or full selections normalize to `undefined` (all rooms).
 */
export const toggleSpaceRoomGroupSelection = (
  selectedRoomIds: ReadonlySet<string> | undefined,
  groupRoomIds: readonly string[],
  allRoomIds: readonly string[]
): Set<string> | undefined => {
  const valid = new Set(allRoomIds);
  const target = groupRoomIds.filter((id) => valid.has(id));
  const current = pruneSpaceRoomSelection(selectedRoomIds, allRoomIds);
  if (target.length === 0) return current;
  const next = new Set(current);
  const allSelected = target.every((id) => next.has(id));
  target.forEach((id) => {
    if (allSelected) next.delete(id);
    else next.add(id);
  });
  return pruneSpaceRoomSelection(next, allRoomIds);
};

export type SwitchableSpaceItem = {
  room: Room;
  spaceId: string;
  name: string;
  depth: number;
};

/**
 * Ordered, cycle-safe list of joined spaces and subspaces for the All threads header switcher:
 * walks `railSpaceIds` with pre-order DFS over each space's joined subspaces (siblings sorted A-Z),
 * then sweeps any remaining joined spaces (parentless roots first, then cycles/orphans, A-Z).
 */
export const buildSwitchableSpaceItems = (
  mx: MatrixClient,
  railSpaceIds: readonly string[],
  joinedRoomIds: readonly string[],
  roomToParents: RoomToParents
): SwitchableSpaceItem[] => {
  const joinedSpaceIds = joinedRoomIds.filter((roomId) => isSpace(mx.getRoom(roomId)));
  const joinedSpaceSet = new Set(joinedSpaceIds);
  const joinedList = [...joinedRoomIds];
  const emitted = new Set<string>();
  const items: SwitchableSpaceItem[] = [];

  const emitTree = (rootSpaceId: string) => {
    const walk = (spaceId: string, depth: number) => {
      if (emitted.has(spaceId) || !joinedSpaceSet.has(spaceId)) return;
      const room = mx.getRoom(spaceId);
      if (!room) return;
      emitted.add(spaceId);
      items.push({
        room,
        spaceId,
        name: revealDirectionControls(room.name || room.roomId),
        depth,
      });
      sortRoomIdsByName(mx, getJoinedSubspaces(mx, spaceId, joinedList, roomToParents)).forEach(
        (childId) => walk(childId, depth + 1)
      );
    };
    walk(rootSpaceId, 0);
  };

  railSpaceIds.forEach(emitTree);

  const remaining = sortRoomIdsByName(
    mx,
    joinedSpaceIds.filter((id) => !emitted.has(id))
  );
  const remainingRoots = remaining.filter(
    (id) => ![...(roomToParents.get(id) ?? [])].some((parentId) => joinedSpaceSet.has(parentId))
  );
  [...remainingRoots, ...remaining].forEach(emitTree);
  return items;
};

export type SpaceRoomFilterGroup = {
  spaceId: string;
  room: Room;
  name: string;
  depth: number;
  directRoomIds: string[];
  subtreeRoomIds: string[];
};

export type SpaceRoomFilterGroups = {
  rootRoomIds: string[];
  subspaces: SpaceRoomFilterGroup[];
};

export type BuildSpaceRoomFilterGroupsOptions = {
  mx: MatrixClient;
  spaceId: string;
  roomsById: ReadonlyMap<string, Pick<SpaceRoomItem, 'room' | 'name'>>;
  orderedRoomIds: readonly string[];
  joinedRoomIds: readonly string[];
  directs: Set<string>;
  roomToParents: RoomToParents;
  chatRooms: ReadonlySet<string>;
};

/**
 * Groups a Space's visible rooms into root rooms and toggleable subspace sections matching the
 * sidebar's subspace deduplication. Returns `undefined` when no toggleable subspace groups remain.
 */
export const buildSpaceRoomFilterGroups = ({
  mx,
  spaceId,
  roomsById,
  orderedRoomIds,
  joinedRoomIds,
  directs,
  roomToParents,
  chatRooms,
}: BuildSpaceRoomFilterGroupsOptions): SpaceRoomFilterGroups | undefined => {
  const visibleRoomIds = orderedRoomIds.filter((id) => roomsById.has(id));
  if (visibleRoomIds.length <= 1) return undefined;
  const visibleSet = new Set(visibleRoomIds);
  const spaceRoomsByName = sortRoomIdsByName(mx, visibleRoomIds);
  const sections = getSpaceRoomSections(
    mx,
    spaceId,
    [...joinedRoomIds],
    visibleRoomIds,
    spaceRoomsByName,
    directs,
    roomToParents,
    chatRooms,
    () => true
  );

  const rootSection = sections.find((section) => section.isRoot);
  const subspaceSections = sections.filter((section) => !section.isRoot);
  if (subspaceSections.length === 0) return undefined;

  const candidates = subspaceSections
    .map((section) => {
      const room = mx.getRoom(section.spaceId);
      if (!room) return undefined;
      const directRoomIds = section.scopeRoomsByName.filter((id) => visibleSet.has(id));
      const subtreeSet = new Set(directRoomIds);
      subspaceSections.forEach((other) => {
        if (other.ancestorSpaceIds.includes(section.spaceId)) {
          other.scopeRoomsByName.forEach((id) => {
            if (visibleSet.has(id)) subtreeSet.add(id);
          });
        }
      });
      const subtreeRoomIds = spaceRoomsByName.filter((id) => subtreeSet.has(id));
      if (subtreeRoomIds.length === 0 || subtreeRoomIds.length === visibleRoomIds.length) {
        return undefined;
      }
      return { section, room, directRoomIds, subtreeRoomIds };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  if (candidates.length === 0) return undefined;

  const keptSpaceIds = new Set(candidates.map((entry) => entry.section.spaceId));
  const subspaces: SpaceRoomFilterGroup[] = candidates.map(
    ({ section, room, directRoomIds, subtreeRoomIds }) => ({
      spaceId: section.spaceId,
      room,
      name: revealDirectionControls(room.name || room.roomId),
      depth: 1 + section.ancestorSpaceIds.filter((id) => keptSpaceIds.has(id)).length,
      directRoomIds,
      subtreeRoomIds,
    })
  );

  const placedInSubspace = new Set(subspaces.flatMap((group) => group.directRoomIds));
  const rootRoomIds: string[] = [];
  const placedRoot = new Set<string>();
  const addRoot = (id: string) => {
    if (!visibleSet.has(id) || placedInSubspace.has(id) || placedRoot.has(id)) return;
    placedRoot.add(id);
    rootRoomIds.push(id);
  };
  rootSection?.scopeRoomsByName.forEach(addRoot);
  spaceRoomsByName.forEach(addRoot);

  return { rootRoomIds, subspaces };
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
