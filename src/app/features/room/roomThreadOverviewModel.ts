import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { getThreadLastActivityTs } from '../../hooks/useThreadLastActivityTs';
import { getThreadStreamingState } from '../../hooks/useThreadStreamingState';
import { parseScheduledTaskStateEvent } from '../../utils/scheduledTaskContract';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ThreadFilter = 'all' | 'unresolved' | 'resolved' | 'unread';

export type ThreadSort = 'default' | 'last-reply' | 'streaming' | 'scheduled';

export type RoomThreadOverviewCounts = {
  all: number;
  unresolved: number;
  resolved: number;
  unread: number;
};

export type ThreadOverviewMetadata = {
  isResolved: boolean;
  isUnread: boolean;
  isStreaming: boolean;
  scheduledTaskCount: number;
  lastActivityTs: number;
  absoluteIndex: number;
};

// ─── Batch scheduled task helper ────────────────────────────────────────────

/**
 * Groups pending future scheduled tasks by threadId.
 * Reused by `useThreadScheduledTasks` and the batch metadata builder.
 */
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

/**
 * Room-level receipt heuristic for thread unread state.
 *
 * A thread is considered unread when its latest relevant reply:
 * - is newer than the room-level read-up-to timestamp,
 * - comes from another sender (not the current user).
 *
 * This is an approximation — thread-scoped receipts are not supported.
 */
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

  // The latest reply in the thread determines unread state.
  // If the current user sent the last reply, the thread is not unread.
  const latestReply = replyEvents[replyEvents.length - 1];
  if (latestReply.getSender() === currentUserId) return false;

  // If no read marker exists, any latest reply from another user = unread
  if (readUpToTs === undefined) return true;

  return latestReply.getTs() > readUpToTs;
};

// ─── Metadata builder ───────────────────────────────────────────────────────

export const buildThreadMetadataMap = (
  room: Room,
  threadRootIds: string[],
  threadResolutionMap: Map<string, { isResolved: boolean }>,
  scheduledTaskCounts: Map<string, number>,
  currentUserId: string,
  readUpToTs: number | undefined,
  absoluteIndexMap: Map<string, number>
): Map<string, ThreadOverviewMetadata> => {
  const metadataMap = new Map<string, ThreadOverviewMetadata>();

  for (const threadRootId of threadRootIds) {
    const isResolved = threadResolutionMap.get(threadRootId)?.isResolved ?? false;
    const isStreaming = getThreadStreamingState(room, threadRootId);
    const scheduledTaskCount = scheduledTaskCounts.get(threadRootId) ?? 0;
    const lastActivityTs = getThreadLastActivityTs(room, threadRootId) ?? 0;
    const absoluteIndex = absoluteIndexMap.get(threadRootId) ?? 0;
    const unread = isThreadUnread(room, threadRootId, currentUserId, readUpToTs);

    metadataMap.set(threadRootId, {
      isResolved,
      isUnread: unread,
      isStreaming,
      scheduledTaskCount,
      lastActivityTs,
      absoluteIndex,
    });
  }

  return metadataMap;
};

// ─── Filter ─────────────────────────────────────────────────────────────────

export const filterThreadRootEvents = (
  threadRootEventIds: string[],
  filter: ThreadFilter,
  metadataMap: Map<string, ThreadOverviewMetadata>
): string[] => {
  if (filter === 'all') return threadRootEventIds;

  return threadRootEventIds.filter((id) => {
    const meta = metadataMap.get(id);
    if (!meta) return false;

    switch (filter) {
      case 'unresolved':
        return !meta.isResolved;
      case 'resolved':
        return meta.isResolved;
      case 'unread':
        return meta.isUnread;
      default:
        return true;
    }
  });
};

// ─── Sort comparators ───────────────────────────────────────────────────────

const compareByLastActivity = (
  a: ThreadOverviewMetadata,
  b: ThreadOverviewMetadata
): number => {
  const diff = b.lastActivityTs - a.lastActivityTs;
  return diff !== 0 ? diff : a.absoluteIndex - b.absoluteIndex;
};

export const sortThreadRootEvents = (
  threadRootEventIds: string[],
  sort: ThreadSort,
  metadataMap: Map<string, ThreadOverviewMetadata>
): string[] => {
  if (sort === 'default') return threadRootEventIds;

  const sorted = [...threadRootEventIds];

  sorted.sort((aId, bId) => {
    const a = metadataMap.get(aId);
    const b = metadataMap.get(bId);
    if (!a || !b) return 0;

    switch (sort) {
      case 'last-reply':
        return compareByLastActivity(a, b);

      case 'streaming': {
        // Streaming threads first
        if (a.isStreaming !== b.isStreaming) {
          return a.isStreaming ? -1 : 1;
        }
        return compareByLastActivity(a, b);
      }

      case 'scheduled': {
        // Threads with scheduled tasks first
        const aHasScheduled = a.scheduledTaskCount > 0;
        const bHasScheduled = b.scheduledTaskCount > 0;
        if (aHasScheduled !== bHasScheduled) {
          return aHasScheduled ? -1 : 1;
        }
        return compareByLastActivity(a, b);
      }

      default:
        return 0;
    }
  });

  return sorted;
};

// ─── Counts ─────────────────────────────────────────────────────────────────

export const computeOverviewCounts = (
  metadataMap: Map<string, ThreadOverviewMetadata>
): RoomThreadOverviewCounts => {
  let unresolved = 0;
  let resolved = 0;
  let unread = 0;

  metadataMap.forEach((meta) => {
    if (meta.isResolved) {
      resolved += 1;
    } else {
      unresolved += 1;
    }
    if (meta.isUnread) {
      unread += 1;
    }
  });

  return {
    all: unresolved + resolved,
    unresolved,
    resolved,
    unread,
  };
};
