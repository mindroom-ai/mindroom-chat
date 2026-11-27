import {
  getRoomThreadScheduledStatusMap,
  type ThreadScheduledStatus,
} from '../../event-store/threads/threadScheduledStatus';
import { roomActiveRuns } from '../../matrix/protocol/activeRunsContract';
import { roomThreadBackgroundJobs } from '../../matrix/protocol/threadBackgroundJobs';
import { atom } from 'jotai';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { ThreadSummaryInfo } from '../../matrix/protocol/threadSummary';
import { resolveThreadInvolvement } from '../../event-store/threads/threadInvolvement';
import { getBundledThreadPreviews } from '../../event-store/threads/threadBundledPreviews';
import { buildThreadRecord } from '../../event-store/threads/threadRecord';
import { getRoomThreadTagSnapshotMap, type ThreadTagSnapshot } from '../tags/threadTagSnapshots';
import { getPreferredVisibleThreadReplyEvents } from '../../event-store/threads/threadUtils';
import type { ThreadRecord } from '../../event-store/threads/types';
import { isThreadPinned } from '../../event-store/threads/threadPinning';
import { isThreadResolved } from '../../event-store/threads/threadTags';

export const MAX_CROSS_ROOM_INDEX_ENTRIES = 5000;
export const CROSS_ROOM_INDEX_EVICTION_SLACK = 250;
const KEY_SEPARATOR = '\u0000';

export type CrossRoomThreadIndexEntry = {
  key: string;
  roomId: string;
  roomName: string;
  threadRootId: string;
  indexedEventIds: string[];
  threadRecord: ThreadRecord;
  rootSenderId?: string;
  /** When the root was sent, while it is loaded; unlike `lastActivityTs`, replies leave it. */
  rootTs?: number;
  lastActivityTs: number;
  isUnread: boolean;
  isResolved: boolean;
  /** Set whenever the snoozed tag parses, also after its time. */
  snoozedUntilTs?: number;
  /** The snoozed tag's `set_at`. */
  snoozedAtTs?: number;
  /** While resolved: when, by the server's clock (the tag's state event). */
  resolvedTs?: number;
  hasAttention: boolean;
  isInvolved: boolean;
  // For me before any sidebar pin exception.
  isForUser: boolean;
  summaryText: string;
  rootPreviewText: string;
  searchableText: string;
  tags: string[];
  generation: number;
};

export type CrossRoomThreadEventReverseIndex = Map<string, Map<string, Set<string>>>;

export type CrossRoomThreadIndexSnapshot = {
  entries: Map<string, CrossRoomThreadIndexEntry>;
  eventIdToThreadRoots: CrossRoomThreadEventReverseIndex;
  version: number;
  bootstrapped: boolean;
};

export const emptyCrossRoomThreadIndexSnapshot = (): CrossRoomThreadIndexSnapshot => ({
  entries: new Map(),
  eventIdToThreadRoots: new Map(),
  version: 0,
  bootstrapped: false,
});

export const crossRoomThreadIndexAtom = atom<CrossRoomThreadIndexSnapshot>(
  emptyCrossRoomThreadIndexSnapshot()
);

/** Whether the index has scanned the rooms once; before, an empty list says nothing. */
export const crossRoomThreadIndexBootstrappedAtom = atom(
  (get) => get(crossRoomThreadIndexAtom).bootstrapped
);

export const getCrossRoomThreadIndexKey = (roomId: string, threadRootId: string): string =>
  `${roomId}${KEY_SEPARATOR}${threadRootId}`;

export const parseCrossRoomThreadIndexKey = (
  key: string
): { roomId: string; threadRootId: string } | undefined => {
  const separatorIndex = key.indexOf(KEY_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex >= key.length - 1) return undefined;

  return {
    roomId: key.slice(0, separatorIndex),
    threadRootId: key.slice(separatorIndex + KEY_SEPARATOR.length),
  };
};

const getEntryIndexedEventIds = (entry: CrossRoomThreadIndexEntry): string[] => {
  const indexedEventIds = (entry as { indexedEventIds?: string[] }).indexedEventIds;
  const eventIds = new Set(indexedEventIds ?? []);
  eventIds.add(entry.threadRootId);

  const rootEventId = entry.threadRecord.rootEventId;
  if (rootEventId) eventIds.add(rootEventId);

  return Array.from(eventIds);
};

/**
 * Copy-on-write view over the reverse index for one batch application.
 * Maps and sets belonging to the previous published snapshot are never
 * mutated; each is cloned at most once per batch, no matter how many
 * entries touch it.
 */
type ReverseIndexDraft = {
  index: CrossRoomThreadEventReverseIndex;
  outerCloned: boolean;
  clonedRoomIds: Set<string>;
  ownedThreadRootSets: Set<Set<string>>;
};

const createReverseIndexDraft = (
  reverseIndex: CrossRoomThreadEventReverseIndex
): ReverseIndexDraft => ({
  index: reverseIndex,
  outerCloned: false,
  clonedRoomIds: new Set(),
  ownedThreadRootSets: new Set(),
});

const getMutableReverseIndex = (draft: ReverseIndexDraft): CrossRoomThreadEventReverseIndex => {
  if (!draft.outerCloned) {
    draft.index = new Map(draft.index);
    draft.outerCloned = true;
  }
  return draft.index;
};

const getMutableRoomIndex = (
  draft: ReverseIndexDraft,
  roomId: string
): Map<string, Set<string>> => {
  const reverseIndex = getMutableReverseIndex(draft);
  const existing = reverseIndex.get(roomId);
  if (existing && draft.clonedRoomIds.has(roomId)) return existing;

  const cloned = new Map(existing ?? []);
  draft.clonedRoomIds.add(roomId);
  reverseIndex.set(roomId, cloned);
  return cloned;
};

const draftAddEntryToEventReverseIndex = (
  draft: ReverseIndexDraft,
  entry: CrossRoomThreadIndexEntry
) => {
  const eventIds = getEntryIndexedEventIds(entry);
  if (eventIds.length === 0) return;

  const roomIndex = getMutableRoomIndex(draft, entry.roomId);
  eventIds.forEach((eventId) => {
    const threadRoots = roomIndex.get(eventId);
    if (!threadRoots) {
      const created = new Set([entry.threadRootId]);
      draft.ownedThreadRootSets.add(created);
      roomIndex.set(eventId, created);
      return;
    }
    if (threadRoots.has(entry.threadRootId)) return;
    if (draft.ownedThreadRootSets.has(threadRoots)) {
      threadRoots.add(entry.threadRootId);
      return;
    }

    const cloned = new Set(threadRoots);
    cloned.add(entry.threadRootId);
    draft.ownedThreadRootSets.add(cloned);
    roomIndex.set(eventId, cloned);
  });
};

const draftRemoveEntryFromEventReverseIndex = (
  draft: ReverseIndexDraft,
  entry: CrossRoomThreadIndexEntry
) => {
  const roomIndex = draft.index.get(entry.roomId);
  if (!roomIndex) return;

  const eventIds = getEntryIndexedEventIds(entry).filter((eventId) =>
    roomIndex.get(eventId)?.has(entry.threadRootId)
  );
  if (eventIds.length === 0) return;

  const mutableRoomIndex = getMutableRoomIndex(draft, entry.roomId);
  eventIds.forEach((eventId) => {
    const threadRoots = mutableRoomIndex.get(eventId);
    if (!threadRoots?.has(entry.threadRootId)) return;
    if (threadRoots.size === 1) {
      mutableRoomIndex.delete(eventId);
      return;
    }
    if (draft.ownedThreadRootSets.has(threadRoots)) {
      threadRoots.delete(entry.threadRootId);
      return;
    }

    const cloned = new Set(threadRoots);
    cloned.delete(entry.threadRootId);
    draft.ownedThreadRootSets.add(cloned);
    mutableRoomIndex.set(eventId, cloned);
  });

  if (mutableRoomIndex.size === 0) {
    getMutableReverseIndex(draft).delete(entry.roomId);
    draft.clonedRoomIds.delete(entry.roomId);
  }
};

const removeRoomFromEventReverseIndex = (
  reverseIndex: CrossRoomThreadEventReverseIndex,
  roomId: string
): CrossRoomThreadEventReverseIndex => {
  if (!reverseIndex.has(roomId)) return reverseIndex;

  const nextReverseIndex = new Map(reverseIndex);
  nextReverseIndex.delete(roomId);
  return nextReverseIndex;
};

export const getCrossRoomThreadRootsForEvent = (
  snapshot: CrossRoomThreadIndexSnapshot,
  roomId: string,
  eventId: string | undefined
): string[] => {
  if (!eventId) return [];

  return Array.from(snapshot.eventIdToThreadRoots.get(roomId)?.get(eventId) ?? []);
};

export const normalizeThreadSearchText = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, ' ').trim();

const getEventContent = (event: MatrixEvent | undefined): Record<string, unknown> | undefined => {
  const content = event?.getContent?.();
  return content && typeof content === 'object' && !Array.isArray(content) ? content : undefined;
};

const getEffectiveEventContent = (
  event: MatrixEvent | undefined
): Record<string, unknown> | undefined =>
  getEventContent(event?.replacingEvent?.() ?? undefined) ?? getEventContent(event);

const getEditedContent = (
  content: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  const edited = content?.['m.new_content'];
  return edited && typeof edited === 'object' && !Array.isArray(edited)
    ? (edited as Record<string, unknown>)
    : undefined;
};

const getContentText = (content: Record<string, unknown> | undefined): string | undefined => {
  // The body the SDK gives an event it cannot decrypt is its error text; the shared preview
  // resolver names such an event instead.
  if (content?.msgtype === 'm.bad.encrypted') return undefined;
  const edited = getEditedContent(content);
  const body = edited?.body ?? content?.body;
  const topic = edited?.topic ?? content?.topic;
  const name = edited?.name ?? content?.name;
  const text = body ?? topic ?? name;
  return typeof text === 'string' ? text : undefined;
};

export const buildCrossRoomThreadIndexEntry = ({
  room,
  threadRootId,
  threadRootEvent,
  summaryInfo,
  currentUserId,
  tagSnapshot,
  scheduledStatus,
  activeRunThreads,
}: {
  room: Room;
  threadRootId: string;
  threadRootEvent?: MatrixEvent;
  summaryInfo?: ThreadSummaryInfo;
  currentUserId?: string;
  /** null is an explicitly untagged root in a shared room snapshot. */
  tagSnapshot?: ThreadTagSnapshot | null;
  scheduledStatus?: ThreadScheduledStatus;
  activeRunThreads?: ReadonlySet<string>;
}): CrossRoomThreadIndexEntry | undefined => {
  const thread = room.getThread(threadRootId);
  const resolvedRootEvent =
    threadRootEvent ?? thread?.rootEvent ?? room.findEventById(threadRootId);
  if (!resolvedRootEvent && !thread) return undefined;

  const resolvedTagSnapshot =
    tagSnapshot === undefined ? getRoomThreadTagSnapshotMap(room).get(threadRootId) : tagSnapshot;
  const rootPreviewText =
    getContentText(getEffectiveEventContent(resolvedRootEvent)) ?? summaryInfo?.summaryText ?? '';
  const bundledPreviews = getBundledThreadPreviews(room, resolvedRootEvent);
  const isStreaming = (activeRunThreads ?? roomActiveRuns(room).threads).has(threadRootId);
  const record = buildThreadRecord({
    room,
    threadRootId,
    threadRootEvent: resolvedRootEvent,
    bundledPreviews,
    summaryInfo,
    rootPreviewText,
    scheduledStatus: scheduledStatus ?? getRoomThreadScheduledStatusMap(room).get(threadRootId),
    isStreaming,
    threadResolution: resolvedTagSnapshot
      ? {
          isResolved: isThreadResolved(
            resolvedTagSnapshot.content,
            isThreadPinned(room, threadRootId)
          ),
          tags: resolvedTagSnapshot.content.tags,
        }
      : undefined,
    currentUserId,
  });
  const visibleReplies = getPreferredVisibleThreadReplyEvents(thread);
  const { isInvolved, isForUser, pendingOwnFirstReplyTs } = resolveThreadInvolvement({
    room,
    threadRootId,
    thread,
    rootEvent: resolvedRootEvent,
    userId: currentUserId,
    visibleReplies,
    bundledPreviews,
    replyCount: record.status.replyCount,
  });
  const threadRecord = {
    ...record,
    status: {
      ...record.status,
      ...roomThreadBackgroundJobs(room).get(threadRootId),
      ...(pendingOwnFirstReplyTs !== undefined && { hasPendingSend: true }),
    },
  };
  const summaryText =
    threadRecord.presentation.primarySummaryText ??
    threadRecord.presentation.summaryText ??
    threadRecord.presentation.recentThreadSummaryText ??
    '';
  const baseLastActivityTs =
    threadRecord.status.lastActivityTs ??
    resolvedRootEvent?.getTs?.() ??
    summaryInfo?.generatedTs ??
    0;
  const lastActivityTs =
    pendingOwnFirstReplyTs !== undefined
      ? Math.max(baseLastActivityTs, pendingOwnFirstReplyTs)
      : baseLastActivityTs;
  const rootTs = resolvedRootEvent?.getTs?.();
  const isResolved = threadRecord.status.isResolved;
  const resolvedTs = isResolved ? resolvedTagSnapshot?.resolvedTs : undefined;
  const hasAttention =
    !isResolved &&
    (threadRecord.status.isUnread ||
      threadRecord.status.isStreaming ||
      threadRecord.status.scheduledTaskCount > 0);
  const indexedEventIds = new Set<string>();
  indexedEventIds.add(threadRootId);
  const rootEventId = resolvedRootEvent?.getId?.() ?? threadRecord.rootEventId;
  if (rootEventId) indexedEventIds.add(rootEventId);
  visibleReplies.forEach((event) => {
    const eventId = event.getId?.();
    if (eventId) indexedEventIds.add(eventId);
  });
  return {
    key: getCrossRoomThreadIndexKey(room.roomId, threadRootId),
    roomId: room.roomId,
    roomName: room.name || room.roomId,
    threadRootId,
    indexedEventIds: Array.from(indexedEventIds),
    threadRecord,
    rootSenderId: resolvedRootEvent?.getSender?.(),
    ...(rootTs !== undefined ? { rootTs } : {}),
    lastActivityTs,
    isUnread: threadRecord.status.isUnread,
    isResolved,
    ...(threadRecord.status.snoozedUntilTs !== undefined
      ? {
          snoozedUntilTs: threadRecord.status.snoozedUntilTs,
          snoozedAtTs: threadRecord.status.snoozedAtTs,
        }
      : {}),
    ...(resolvedTs !== undefined ? { resolvedTs } : {}),
    hasAttention,
    isInvolved,
    isForUser,
    summaryText,
    rootPreviewText,
    searchableText: normalizeThreadSearchText(`${rootPreviewText} ${summaryText}`),
    tags: threadRecord.status.tags,
    generation: 0,
  };
};

const evictOverflowEntries = (
  entries: Map<string, CrossRoomThreadIndexEntry>
): {
  entries: Map<string, CrossRoomThreadIndexEntry>;
  evictedEntries: CrossRoomThreadIndexEntry[];
} => {
  if (entries.size <= MAX_CROSS_ROOM_INDEX_ENTRIES + CROSS_ROOM_INDEX_EVICTION_SLACK) {
    return { entries, evictedEntries: [] };
  }

  const keepKeys = new Set(
    Array.from(entries.values())
      .sort((left, right) => right.lastActivityTs - left.lastActivityTs)
      .slice(0, MAX_CROSS_ROOM_INDEX_ENTRIES)
      .map((entry) => entry.key)
  );

  const nextEntries = new Map<string, CrossRoomThreadIndexEntry>();
  const evictedEntries: CrossRoomThreadIndexEntry[] = [];

  entries.forEach((entry, key) => {
    if (keepKeys.has(key)) {
      nextEntries.set(key, entry);
      return;
    }

    evictedEntries.push(entry);
  });

  return { entries: nextEntries, evictedEntries };
};

const arePlainValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => arePlainValuesEqual(value, right[index]));
  }
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined);
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => arePlainValuesEqual(leftRecord[key], rightRecord[key]));
};

export const areCrossRoomThreadIndexEntriesEquivalent = (
  left: CrossRoomThreadIndexEntry,
  right: CrossRoomThreadIndexEntry
): boolean => {
  if (left === right) return true;

  const { generation: leftGeneration, ...leftRest } = left;
  const { generation: rightGeneration, ...rightRest } = right;
  return arePlainValuesEqual(leftRest, rightRest);
};

export type CrossRoomThreadIndexBatchRemoval = { roomId: string; threadRootId: string };

export type CrossRoomThreadIndexBatch = {
  upserts?: CrossRoomThreadIndexEntry[];
  removals?: CrossRoomThreadIndexBatchRemoval[];
};

/**
 * Apply a whole flush of dirty-entry writes as one snapshot transition.
 * The entries map and reverse-index maps are cloned at most once per
 * batch, removed keys that are absent and rebuilt entries that are
 * semantically unchanged are dropped, and when nothing effective
 * remains the input snapshot is returned unchanged (same reference,
 * same version).
 */
export const applyCrossRoomThreadIndexBatch = (
  snapshot: CrossRoomThreadIndexSnapshot,
  { upserts = [], removals = [] }: CrossRoomThreadIndexBatch
): CrossRoomThreadIndexSnapshot => {
  let entries: Map<string, CrossRoomThreadIndexEntry> | undefined;
  const reverseDraft = createReverseIndexDraft(snapshot.eventIdToThreadRoots);
  const readEntries = () => entries ?? snapshot.entries;

  removals.forEach(({ roomId, threadRootId }) => {
    const key = getCrossRoomThreadIndexKey(roomId, threadRootId);
    const current = readEntries().get(key);
    if (!current) return;

    entries ??= new Map(snapshot.entries);
    entries.delete(key);
    draftRemoveEntryFromEventReverseIndex(reverseDraft, current);
  });

  upserts.forEach((entry) => {
    const current = readEntries().get(entry.key);
    if (current && areCrossRoomThreadIndexEntriesEquivalent(current, entry)) return;

    const nextEntry = {
      ...entry,
      generation: current ? current.generation + 1 : entry.generation,
    };
    entries ??= new Map(snapshot.entries);
    entries.set(entry.key, nextEntry);
    if (current) draftRemoveEntryFromEventReverseIndex(reverseDraft, current);
    draftAddEntryToEventReverseIndex(reverseDraft, nextEntry);
  });

  if (!entries) return snapshot;

  const evicted = evictOverflowEntries(entries);
  evicted.evictedEntries.forEach((evictedEntry) => {
    draftRemoveEntryFromEventReverseIndex(reverseDraft, evictedEntry);
  });

  return {
    ...snapshot,
    entries: evicted.entries,
    eventIdToThreadRoots: reverseDraft.index,
    version: snapshot.version + 1,
  };
};

export const removeCrossRoomThreadIndexEntry = (
  snapshot: CrossRoomThreadIndexSnapshot,
  roomId: string,
  threadRootId: string
): CrossRoomThreadIndexSnapshot =>
  applyCrossRoomThreadIndexBatch(snapshot, { removals: [{ roomId, threadRootId }] });

export const removeRoomCrossRoomThreadIndexEntries = (
  snapshot: CrossRoomThreadIndexSnapshot,
  roomId: string
): CrossRoomThreadIndexSnapshot => {
  const entries = new Map(snapshot.entries);
  let removed = false;
  entries.forEach((entry, key) => {
    if (entry.roomId !== roomId) return;
    entries.delete(key);
    removed = true;
  });

  if (!removed) return snapshot;
  return {
    ...snapshot,
    entries,
    eventIdToThreadRoots: removeRoomFromEventReverseIndex(snapshot.eventIdToThreadRoots, roomId),
    version: snapshot.version + 1,
  };
};

export type CrossRoomThreadDirtyCoalescer = {
  enqueueDirty: (key: string) => void;
  discardDirty: (key: string) => void;
  flushNow: () => void;
  clear: () => void;
};

const FLUSH_INTERVAL_MS = 200;

/** A scheduled flush; the timer is unset while it waits on a microtask. */
type PendingFlush = { timer?: ReturnType<typeof setTimeout> };

/**
 * Coalesces dirty keys into flushes with a leading edge: an isolated update
 * flushes on the next microtask, while a burst waits until 200 ms
 * after the previous flush ended, measured on the monotonic
 * `performance.now()` clock. SDK thread initialization and streamed edits emit
 * many updates per thread in separate tasks; flushing on every microtask
 * rebuilt each entry a median of 14 times at startup (3,065 flushes for 577
 * threads on a large account). `flushNow` supersedes the pending flush, and a
 * flush that finds no keys leaves the interval untouched.
 */
export const createCrossRoomThreadDirtyCoalescer = (
  flushDirtyKeys: (keys: string[]) => void
): CrossRoomThreadDirtyCoalescer => {
  const dirtyKeys = new Set<string>();
  let lastFlushEndedAt = Number.NEGATIVE_INFINITY;
  let pending: PendingFlush | undefined;

  const cancelPending = () => {
    if (pending?.timer !== undefined) clearTimeout(pending.timer);
    pending = undefined;
  };

  const flushNow = () => {
    cancelPending();
    if (dirtyKeys.size === 0) return;

    const keys = Array.from(dirtyKeys);
    dirtyKeys.clear();
    flushDirtyKeys(keys);
    lastFlushEndedAt = performance.now();
  };

  const schedule = () => {
    const run: PendingFlush = {};
    pending = run;
    // A superseded run (flushNow or clear) must not flush later keys early.
    const fire = () => {
      if (pending === run) flushNow();
    };
    const waitMs = lastFlushEndedAt + FLUSH_INTERVAL_MS - performance.now();
    if (waitMs <= 0) queueMicrotask(fire);
    else run.timer = setTimeout(fire, waitMs);
  };

  return {
    enqueueDirty: (key: string) => {
      dirtyKeys.add(key);
      if (!pending) schedule();
    },
    discardDirty: (key: string) => {
      dirtyKeys.delete(key);
    },
    flushNow,
    clear: () => {
      dirtyKeys.clear();
      cancelPending();
    },
  };
};
