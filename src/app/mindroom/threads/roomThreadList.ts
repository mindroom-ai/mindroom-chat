/* eslint-disable no-console */

import { Direction } from 'matrix-js-sdk/lib/models/event-timeline';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { Thread } from 'matrix-js-sdk/lib/models/thread';
import { isVisibleThreadReplyEvent } from './threadUtils';
import {
  createDeepTraceOperationId,
  recordDeepTraceEvent,
  roundDeepTraceMetric,
} from '../diagnostics/deepTrace';

const getThreadCount = (room: Room): number => room.getThreads?.().length ?? 0;

const getLatestVisibleReply = (thread: Thread) =>
  [...(thread.events ?? [])].reverse().find(isVisibleThreadReplyEvent) ??
  (thread.replyToEvent && isVisibleThreadReplyEvent(thread.replyToEvent)
    ? thread.replyToEvent
    : undefined);

const findThreadReceiptEvent = (thread: Thread, eventId: string): MatrixEvent | undefined => {
  const timelineEvent = thread.events?.find((event) => event.getId() === eventId);
  if (timelineEvent) return timelineEvent;
  if (thread.replyToEvent?.getId?.() === eventId) return thread.replyToEvent;
  if (thread.rootEvent?.getId?.() === eventId) return thread.rootEvent;
  return undefined;
};

export const getThreadReadUpToTs = (
  thread: Thread | null | undefined,
  userId: string | undefined
): number | undefined => {
  if (!thread || !userId || typeof thread.getEventReadUpTo !== 'function') return undefined;

  const readUpToId = thread.getEventReadUpTo(userId);
  if (!readUpToId) return undefined;

  const readUpToEvent = findThreadReceiptEvent(thread, readUpToId);
  // A thread receipt can target a paginated-out event; without its timestamp,
  // the room-level receipt is the only orderable fallback.
  return readUpToEvent?.getTs();
};

export const getEffectiveThreadReadUpToTs = (
  thread: Thread | null | undefined,
  userId: string | undefined,
  roomReadUpToTs: number | null | undefined
): number | null | undefined => {
  const threadReadUpToTs = getThreadReadUpToTs(thread, userId);
  if (threadReadUpToTs === undefined) return roomReadUpToTs;
  if (typeof roomReadUpToTs !== 'number') return threadReadUpToTs;
  return Math.max(threadReadUpToTs, roomReadUpToTs);
};

export const getThreadLastActivityTs = (thread: Thread): number =>
  getLatestVisibleReply(thread)?.getTs() ?? thread.rootEvent?.getTs() ?? 0;

/**
 * Check if a single thread has unread messages.
 * A thread is unread when its latest reply is from another user
 * and is newer than both the thread-scoped and room-level read receipts.
 */
export const getThreadUnread = (room: Room, thread: Thread, userId: string): boolean => {
  const latestReply = getLatestVisibleReply(thread);
  if (!latestReply) return false;

  if (latestReply.getSender() === userId) return false;

  const readUpToId = room.getEventReadUpTo(userId);
  const roomReadUpToTs = readUpToId ? room.findEventById(readUpToId)?.getTs() : null;
  const readUpToTs = getEffectiveThreadReadUpToTs(thread, userId, roomReadUpToTs ?? null) ?? null;
  if (readUpToTs === null) return true;

  return latestReply.getTs() > readUpToTs;
};

/**
 * Return a Map of threadRootId → boolean for all given threads,
 * indicating which have unread messages.
 */
export const getRoomThreadsUnread = (
  room: Room,
  threads: Thread[],
  userId: string
): Map<string, boolean> => {
  const unreadMap = new Map<string, boolean>();
  for (const thread of threads) {
    const rootId = thread.id;
    unreadMap.set(rootId, getThreadUnread(room, thread, userId));
  }
  return unreadMap;
};

export const sortThreadsByActivity = (
  threads: Thread[],
  threadUnreads?: Map<string, boolean>
): Thread[] =>
  [...threads].sort((threadA, threadB) => {
    // Unread threads sort first when unread data is provided
    if (threadUnreads) {
      const aUnread = threadUnreads.get(threadA.id) ?? false;
      const bUnread = threadUnreads.get(threadB.id) ?? false;
      if (aUnread !== bUnread) return aUnread ? -1 : 1;
    }
    return getThreadLastActivityTs(threadB) - getThreadLastActivityTs(threadA);
  });

const getAllThreadsLiveTimeline = (room: Room) => room.threadsTimelineSets[0]?.getLiveTimeline();

const ensureThreadTimelineSets = async (room: Room): Promise<void> => {
  if (!Thread.hasServerSideListSupport || room.threadsTimelineSets.length > 0) {
    return;
  }

  if (!room.client?.supportsThreads?.()) {
    console.warn('[threadList] SDK thread support not enabled, skipping server-side thread list');
    return;
  }

  try {
    await room.createThreadsTimelineSets();
  } catch (err) {
    console.warn('[threadList] createThreadsTimelineSets failed:', err);
  }

  if (room.threadsTimelineSets.length === 0) {
    console.warn('[threadList] Timeline sets empty after creation attempt');
  }
};

export const roomThreadListIsComplete = (room: Room): boolean => {
  if (!Thread.hasServerSideListSupport) return true;

  const allThreadsLiveTimeline = getAllThreadsLiveTimeline(room);
  if (!allThreadsLiveTimeline) return true;

  return allThreadsLiveTimeline.getPaginationToken(Direction.Backward) === null;
};

export const loadRoomThreads = async (room: Room, onProgress?: () => void): Promise<void> => {
  const operationId = createDeepTraceOperationId();
  const startedAt = performance.now();
  recordDeepTraceEvent(
    'thread_list.load.start',
    {
      operation_id: operationId,
      existing_threads: getThreadCount(room),
      server_side: Thread.hasServerSideListSupport,
    },
    { flush: true }
  );
  await ensureThreadTimelineSets(room);
  const fetchStartedAt = performance.now();
  recordDeepTraceEvent('thread_list.fetch.start', {
    operation_id: operationId,
  });
  try {
    await room.fetchRoomThreads();
  } catch (err) {
    console.warn('[threadList] fetchRoomThreads failed:', err);
    recordDeepTraceEvent(
      'thread_list.fetch.error',
      {
        operation_id: operationId,
        duration_ms: roundDeepTraceMetric(performance.now() - fetchStartedAt),
      },
      { flush: true }
    );
    return;
  }
  recordDeepTraceEvent('thread_list.fetch.complete', {
    operation_id: operationId,
    duration_ms: roundDeepTraceMetric(performance.now() - fetchStartedAt),
    thread_count: getThreadCount(room),
  });
  onProgress?.();

  if (!Thread.hasServerSideListSupport) {
    recordDeepTraceEvent('thread_list.load.complete', {
      operation_id: operationId,
      duration_ms: roundDeepTraceMetric(performance.now() - startedAt),
      page_count: 0,
      thread_count: getThreadCount(room),
    });
    return;
  }

  const allThreadsLiveTimeline = getAllThreadsLiveTimeline(room);
  if (!allThreadsLiveTimeline) {
    recordDeepTraceEvent('thread_list.load.complete', {
      operation_id: operationId,
      duration_ms: roundDeepTraceMetric(performance.now() - startedAt),
      page_count: 0,
      thread_count: getThreadCount(room),
    });
    return;
  }

  let pageCount = 0;
  for (;;) {
    const currentToken = allThreadsLiveTimeline.getPaginationToken(Direction.Backward);
    if (currentToken === null) {
      recordDeepTraceEvent('thread_list.load.complete', {
        operation_id: operationId,
        duration_ms: roundDeepTraceMetric(performance.now() - startedAt),
        page_count: pageCount,
        thread_count: getThreadCount(room),
      });
      return;
    }

    const pageStartedAt = performance.now();
    recordDeepTraceEvent('thread_list.page.start', {
      operation_id: operationId,
      page_index: pageCount,
    });
    const hasMore = await room.client.paginateEventTimeline(allThreadsLiveTimeline, {
      backwards: true,
    });
    pageCount += 1;
    recordDeepTraceEvent('thread_list.page.complete', {
      operation_id: operationId,
      page_index: pageCount - 1,
      duration_ms: roundDeepTraceMetric(performance.now() - pageStartedAt),
      has_more: hasMore,
      thread_count: getThreadCount(room),
    });
    onProgress?.();

    const nextToken = allThreadsLiveTimeline.getPaginationToken(Direction.Backward);
    if (!hasMore || nextToken === currentToken) {
      recordDeepTraceEvent('thread_list.load.complete', {
        operation_id: operationId,
        duration_ms: roundDeepTraceMetric(performance.now() - startedAt),
        page_count: pageCount,
        thread_count: getThreadCount(room),
        stalled_token: nextToken === currentToken,
      });
      return;
    }
  }
};
