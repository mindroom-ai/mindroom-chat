import { atom } from 'jotai';
import type { MatrixEvent } from 'matrix-js-sdk';
import { RelationType } from 'matrix-js-sdk/lib/@types/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import type { MindroomThreadSummaryInfo } from '../messages/threadSummary';
import { isPendingLocalEchoEvent } from '../messages/pendingLocalEcho';
import { buildThreadRecord } from '../threads/threadRecord';
import { getRoomThreadTagSnapshotMap, type ThreadTagSnapshot } from '../threads/threadTagSnapshots';
import { getPreferredVisibleThreadReplyEvents } from '../threads/threadUtils';
import type { ThreadRecord } from '../threads/types';

export const MAX_CROSS_ROOM_INDEX_ENTRIES = 5000;
export const CROSS_ROOM_INDEX_EVICTION_SLACK = 250;
const KEY_SEPARATOR = '\u0000';

export type CrossRoomThreadIndexEntry = {
  key: string;
  roomId: string;
  roomName: string;
  parentSpaceIds: string[];
  threadRootId: string;
  indexedEventIds: string[];
  threadRecord: ThreadRecord;
  rootSenderId?: string;
  lastActivityTs: number;
  isUnread: boolean;
  isResolved: boolean;
  hasAttention: boolean;
  isInvolved: boolean;
  summaryText: string;
  rootPreviewText: string;
  searchableText: string;
  tagSnapshot?: ThreadTagSnapshot;
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

const addEntryToEventReverseIndex = (
  reverseIndex: CrossRoomThreadEventReverseIndex,
  entry: CrossRoomThreadIndexEntry
): CrossRoomThreadEventReverseIndex => {
  const eventIds = getEntryIndexedEventIds(entry);
  if (eventIds.length === 0) return reverseIndex;

  const nextReverseIndex = new Map(reverseIndex);
  const nextRoomIndex = new Map(nextReverseIndex.get(entry.roomId) ?? new Map());

  eventIds.forEach((eventId) => {
    const nextThreadRoots = new Set(nextRoomIndex.get(eventId) ?? new Set());
    nextThreadRoots.add(entry.threadRootId);
    nextRoomIndex.set(eventId, nextThreadRoots);
  });

  nextReverseIndex.set(entry.roomId, nextRoomIndex);
  return nextReverseIndex;
};

const removeEntryFromEventReverseIndex = (
  reverseIndex: CrossRoomThreadEventReverseIndex,
  entry: CrossRoomThreadIndexEntry
): CrossRoomThreadEventReverseIndex => {
  const roomIndex = reverseIndex.get(entry.roomId);
  if (!roomIndex) return reverseIndex;

  let nextRoomIndex: Map<string, Set<string>> | undefined;

  getEntryIndexedEventIds(entry).forEach((eventId) => {
    const threadRoots = (nextRoomIndex ?? roomIndex).get(eventId);
    if (!threadRoots?.has(entry.threadRootId)) return;

    nextRoomIndex ??= new Map(roomIndex);
    const nextThreadRoots = new Set(threadRoots);
    nextThreadRoots.delete(entry.threadRootId);

    if (nextThreadRoots.size > 0) {
      nextRoomIndex.set(eventId, nextThreadRoots);
      return;
    }

    nextRoomIndex.delete(eventId);
  });

  if (!nextRoomIndex) return reverseIndex;

  const nextReverseIndex = new Map(reverseIndex);
  if (nextRoomIndex.size > 0) {
    nextReverseIndex.set(entry.roomId, nextRoomIndex);
  } else {
    nextReverseIndex.delete(entry.roomId);
  }

  return nextReverseIndex;
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
  return content && typeof content === 'object' && !Array.isArray(content)
    ? (content as Record<string, unknown>)
    : undefined;
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
  const edited = getEditedContent(content);
  const body = edited?.body ?? content?.body;
  const topic = edited?.topic ?? content?.topic;
  const name = edited?.name ?? content?.name;
  const text = body ?? topic ?? name;
  return typeof text === 'string' ? text : undefined;
};

const hasDirectUserMention = (
  content: Record<string, unknown> | undefined,
  userId: string
): boolean => {
  const mentions = content?.['m.mentions'];
  if (!mentions || typeof mentions !== 'object' || Array.isArray(mentions)) return false;

  const mentionRecord = mentions as Record<string, unknown>;
  const userIds = mentionRecord.user_ids;
  return Array.isArray(userIds) && userIds.includes(userId);
};

const getRelationTypeFromContent = (
  content: Record<string, unknown> | undefined
): string | undefined => {
  const relation = content?.['m.relates_to'];
  if (!relation || typeof relation !== 'object' || Array.isArray(relation)) return undefined;

  const relationRecord = relation as Record<string, unknown>;
  return typeof relationRecord.rel_type === 'string' ? relationRecord.rel_type : undefined;
};

const isReplacementEvent = (
  event: MatrixEvent | undefined,
  content: Record<string, unknown> | undefined
): boolean =>
  event?.getRelation?.()?.rel_type === RelationType.Replace ||
  getRelationTypeFromContent(content) === RelationType.Replace;

const getPendingOwnThreadReply = (
  room: Room,
  threadRootId: string,
  currentUserId: string | undefined
): MatrixEvent | undefined => {
  if (!currentUserId) return undefined;

  return (room.relations?.getAllChildEventsForEvent(threadRootId) ?? [])
    .filter((event) => {
      const relation = event.getRelation?.();
      const isDirectThreadReply =
        event.threadRootId === threadRootId ||
        (relation?.rel_type === RelationType.Thread && relation.event_id === threadRootId);
      return (
        isDirectThreadReply &&
        event.getSender?.() === currentUserId &&
        isPendingLocalEchoEvent(event)
      );
    })
    .sort((left, right) => left.getTs() - right.getTs())
    .at(-1);
};

const getMentionSourceContent = (
  event: MatrixEvent | undefined,
  content: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  const editedContent = getEditedContent(content);
  if (editedContent && isReplacementEvent(event, content)) return editedContent;

  return editedContent ?? content;
};

const eventDirectlyMentionsUser = (event: MatrixEvent | undefined, userId: string): boolean => {
  const replacementEvent = event?.replacingEvent?.() ?? undefined;
  const content = getEventContent(replacementEvent) ?? getEventContent(event);

  return hasDirectUserMention(getMentionSourceContent(replacementEvent ?? event, content), userId);
};

export const isUserInvolvedInThread = ({
  rootEvent,
  thread,
  userId,
}: {
  rootEvent?: MatrixEvent;
  thread: Thread | null | undefined;
  userId: string | undefined;
}): boolean => {
  if (!userId) return false;
  if (rootEvent?.getSender?.() === userId) return true;
  if (eventDirectlyMentionsUser(rootEvent, userId)) return true;

  const visibleReplies = getPreferredVisibleThreadReplyEvents(thread);
  return visibleReplies.some(
    (event) => event.getSender?.() === userId || eventDirectlyMentionsUser(event, userId)
  );
};

export const buildCrossRoomThreadIndexEntry = ({
  room,
  threadRootId,
  threadRootEvent,
  summaryInfo,
  currentUserId,
  parentSpaceIds = [],
  tagSnapshot,
  generation = 0,
}: {
  room: Room;
  threadRootId: string;
  threadRootEvent?: MatrixEvent;
  summaryInfo?: MindroomThreadSummaryInfo;
  currentUserId?: string;
  parentSpaceIds?: string[];
  tagSnapshot?: ThreadTagSnapshot;
  generation?: number;
}): CrossRoomThreadIndexEntry | undefined => {
  const thread = room.getThread(threadRootId);
  const resolvedRootEvent =
    threadRootEvent ?? thread?.rootEvent ?? room.findEventById(threadRootId);
  if (!resolvedRootEvent && !thread) return undefined;

  const resolvedTagSnapshot = tagSnapshot ?? getRoomThreadTagSnapshotMap(room).get(threadRootId);
  const rootPreviewText =
    getContentText(getEffectiveEventContent(resolvedRootEvent)) ?? summaryInfo?.summaryText ?? '';
  let threadRecord = buildThreadRecord({
    room,
    threadRootId,
    threadRootEvent: resolvedRootEvent,
    summaryInfo,
    rootPreviewText,
    threadResolution: resolvedTagSnapshot
      ? {
          isResolved: resolvedTagSnapshot.isResolved,
          tags: resolvedTagSnapshot.content.tags,
        }
      : undefined,
    currentUserId,
  });
  const pendingOwnReplyEvent =
    threadRecord.status.replyCount === 0
      ? getPendingOwnThreadReply(room, threadRootId, currentUserId)
      : undefined;
  const hasPendingOwnReply =
    threadRecord.status.replyCount === 0 && pendingOwnReplyEvent !== undefined;
  if (hasPendingOwnReply) {
    threadRecord = {
      ...threadRecord,
      status: {
        ...threadRecord.status,
        hasPendingSend: true,
      },
    };
  }
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
  const lastActivityTs = hasPendingOwnReply
    ? Math.max(baseLastActivityTs, pendingOwnReplyEvent.getTs())
    : baseLastActivityTs;
  const isResolved = threadRecord.status.isResolved;
  const hasAttention =
    !isResolved &&
    (threadRecord.status.isUnread ||
      threadRecord.status.isStreaming ||
      threadRecord.status.scheduledTaskCount > 0);
  const indexedEventIds = new Set<string>();
  indexedEventIds.add(threadRootId);
  const rootEventId = resolvedRootEvent?.getId?.() ?? threadRecord.rootEventId;
  if (rootEventId) indexedEventIds.add(rootEventId);
  getPreferredVisibleThreadReplyEvents(thread).forEach((event) => {
    const eventId = event.getId?.();
    if (eventId) indexedEventIds.add(eventId);
  });

  return {
    key: getCrossRoomThreadIndexKey(room.roomId, threadRootId),
    roomId: room.roomId,
    roomName: room.name || room.roomId,
    parentSpaceIds,
    threadRootId,
    indexedEventIds: Array.from(indexedEventIds),
    threadRecord,
    rootSenderId: resolvedRootEvent?.getSender?.(),
    lastActivityTs,
    isUnread: threadRecord.status.isUnread,
    isResolved,
    hasAttention,
    isInvolved:
      hasPendingOwnReply ||
      isUserInvolvedInThread({
        rootEvent: resolvedRootEvent,
        thread,
        userId: currentUserId,
      }),
    summaryText,
    rootPreviewText,
    searchableText: normalizeThreadSearchText(`${rootPreviewText} ${summaryText}`),
    tagSnapshot: resolvedTagSnapshot,
    tags: threadRecord.status.tags,
    generation,
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

export const upsertCrossRoomThreadIndexEntry = (
  snapshot: CrossRoomThreadIndexSnapshot,
  entry: CrossRoomThreadIndexEntry
): CrossRoomThreadIndexSnapshot => {
  const current = snapshot.entries.get(entry.key);
  const entries = new Map(snapshot.entries);
  const nextEntry = {
    ...entry,
    generation: current ? current.generation + 1 : entry.generation,
  };
  entries.set(entry.key, nextEntry);

  let eventIdToThreadRoots = current
    ? removeEntryFromEventReverseIndex(snapshot.eventIdToThreadRoots, current)
    : snapshot.eventIdToThreadRoots;
  eventIdToThreadRoots = addEntryToEventReverseIndex(eventIdToThreadRoots, nextEntry);

  const evicted = evictOverflowEntries(entries);
  evicted.evictedEntries.forEach((evictedEntry) => {
    eventIdToThreadRoots = removeEntryFromEventReverseIndex(eventIdToThreadRoots, evictedEntry);
  });

  return {
    ...snapshot,
    entries: evicted.entries,
    eventIdToThreadRoots,
    version: snapshot.version + 1,
  };
};

export const removeCrossRoomThreadIndexEntry = (
  snapshot: CrossRoomThreadIndexSnapshot,
  roomId: string,
  threadRootId: string
): CrossRoomThreadIndexSnapshot => {
  const key = getCrossRoomThreadIndexKey(roomId, threadRootId);
  if (!snapshot.entries.has(key)) return snapshot;

  const entries = new Map(snapshot.entries);
  const entry = entries.get(key);
  entries.delete(key);
  return {
    ...snapshot,
    entries,
    eventIdToThreadRoots: entry
      ? removeEntryFromEventReverseIndex(snapshot.eventIdToThreadRoots, entry)
      : snapshot.eventIdToThreadRoots,
    version: snapshot.version + 1,
  };
};

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
  flushNow: () => void;
  clear: () => void;
};

export const createCrossRoomThreadDirtyCoalescer = (
  flushDirtyKeys: (keys: string[]) => void,
  schedule: (callback: () => void) => void = queueMicrotask
): CrossRoomThreadDirtyCoalescer => {
  const dirtyKeys = new Set<string>();
  let scheduled = false;

  const flushNow = () => {
    if (dirtyKeys.size === 0) {
      scheduled = false;
      return;
    }

    const keys = Array.from(dirtyKeys);
    dirtyKeys.clear();
    scheduled = false;
    flushDirtyKeys(keys);
  };

  return {
    enqueueDirty: (key: string) => {
      dirtyKeys.add(key);
      if (scheduled) return;
      scheduled = true;
      schedule(flushNow);
    },
    flushNow,
    clear: () => {
      dirtyKeys.clear();
      scheduled = false;
    },
  };
};
