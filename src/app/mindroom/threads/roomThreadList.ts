/* eslint-disable no-console */

import { Direction } from 'matrix-js-sdk/lib/models/event-timeline';
import { ReceiptType } from 'matrix-js-sdk/lib/@types/read_receipts';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { Thread } from 'matrix-js-sdk/lib/models/thread';
import { isVisibleThreadReplyEvent } from './threadUtils';

const getLatestVisibleReply = (thread: Thread): MatrixEvent | undefined => {
  const events = thread.events ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (isVisibleThreadReplyEvent(event)) return event;
  }
  return thread.replyToEvent && isVisibleThreadReplyEvent(thread.replyToEvent)
    ? thread.replyToEvent
    : undefined;
};

const findThreadReceiptEvent = (thread: Thread, eventId: string): MatrixEvent | undefined => {
  const timelineEvent = thread.events?.find((event) => event.getId() === eventId);
  if (timelineEvent) return timelineEvent;
  if (thread.replyToEvent?.getId?.() === eventId) return thread.replyToEvent;
  if (thread.rootEvent?.getId?.() === eventId) return thread.rootEvent;
  return undefined;
};

export const getThreadReadState = (
  thread: Thread | null | undefined,
  userId: string | undefined
): { readEventIds: Set<string>; readUpToTs: number | undefined } | undefined => {
  if (!thread || !userId || typeof thread.getEventReadUpTo !== 'function') return undefined;

  // The SDK validates receipt targets against its timeline, which omits replies
  // known only through the bundled summary. Resolve those receipt IDs here too.
  const readUpToId = thread.getEventReadUpTo(userId);
  const readEventIds = new Set([readUpToId]);
  for (const receiptType of [ReceiptType.Read, ReceiptType.ReadPrivate]) {
    // A retained local echo can mask a newer server receipt outside the timeline.
    for (const ignoreSynthesized of [false, true]) {
      const receipt = thread.getReadReceiptForUserId(userId, ignoreSynthesized, receiptType);
      if (receipt && receipt.data.thread_id === thread.id) readEventIds.add(receipt.eventId);
    }
  }
  let readUpToTs = thread.getLastUnthreadedReceiptFor(userId)?.ts;
  const validReadEventIds = new Set<string>();
  for (const eventId of readEventIds) {
    if (!eventId) continue;
    const event = findThreadReceiptEvent(thread, eventId);
    // Preserve the SDK's consistency check for raw receipt targets.
    if (!event || (eventId !== readUpToId && event.threadRootId !== thread.id)) continue;
    validReadEventIds.add(eventId);
    const eventTs = event.getTs();
    if (readUpToTs === undefined || eventTs > readUpToTs) {
      readUpToTs = eventTs;
    }
  }
  return { readEventIds: validReadEventIds, readUpToTs };
};

export const getEffectiveThreadReadUpToTs = (
  thread: Thread | null | undefined,
  userId: string | undefined,
  roomReadUpToTs: number | null | undefined
): number | null | undefined => {
  const threadReadUpToTs = getThreadReadState(thread, userId)?.readUpToTs;
  if (threadReadUpToTs === undefined) return roomReadUpToTs;
  if (typeof roomReadUpToTs !== 'number') return threadReadUpToTs;
  return Math.max(threadReadUpToTs, roomReadUpToTs);
};

export const getThreadLastActivityTs = (thread: Thread): number =>
  getLatestVisibleReply(thread)?.getTs() ?? thread.rootEvent?.getTs() ?? 0;

const getRoomReadUpToTs = (room: Room, userId: string): number | null => {
  const readUpToId = room.getEventReadUpTo(userId);
  return (readUpToId ? room.findEventById(readUpToId)?.getTs() : null) ?? null;
};

const getThreadUnreadWithRoomReceipt = (
  thread: Thread,
  userId: string,
  readRoomReceipt: () => number | null
): boolean => {
  const latestReply = getLatestVisibleReply(thread);
  if (!latestReply) return false;

  if (latestReply.getSender() === userId) return false;

  const readUpToTs = getEffectiveThreadReadUpToTs(thread, userId, readRoomReceipt()) ?? null;
  if (readUpToTs === null) return true;

  return latestReply.getTs() > readUpToTs;
};

/**
 * A thread is unread when its latest reply is from another user
 * and is newer than both the thread-scoped and room-level read receipts.
 */
export const getThreadUnread = (room: Room, thread: Thread, userId: string): boolean =>
  getThreadUnreadWithRoomReceipt(thread, userId, () => getRoomReadUpToTs(room, userId));

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
  // Read lazily so empty and self-authored threads still need no receipt lookup.
  let roomReadUpToTs: number | null | undefined;
  const readRoomReceipt = () => {
    if (roomReadUpToTs === undefined) roomReadUpToTs = getRoomReadUpToTs(room, userId);
    return roomReadUpToTs;
  };
  for (const thread of threads) {
    const rootId = thread.id;
    unreadMap.set(rootId, getThreadUnreadWithRoomReceipt(thread, userId, readRoomReceipt));
  }
  return unreadMap;
};

export const sortThreadsByActivity = (
  threads: Thread[],
  threadUnreads?: Map<string, boolean>
): Thread[] => {
  const activity = new Map(threads.map((thread) => [thread, getThreadLastActivityTs(thread)]));
  return [...threads].sort((threadA, threadB) => {
    // Unread threads sort first when unread data is provided
    if (threadUnreads) {
      const aUnread = threadUnreads.get(threadA.id) ?? false;
      const bUnread = threadUnreads.get(threadB.id) ?? false;
      if (aUnread !== bUnread) return aUnread ? -1 : 1;
    }
    return activity.get(threadB)! - activity.get(threadA)!;
  });
};

const getAllThreadsLiveTimeline = (room: Room) => room.threadsTimelineSets[0]?.getLiveTimeline();

type RoomThreadListLoad = {
  consumers: Map<symbol, (() => void) | undefined>;
  promise: Promise<void>;
};

const roomThreadListLoads = new WeakMap<Room, RoomThreadListLoad>();

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

const loadRoomThreadsOnce = async (
  room: Room,
  onProgress: () => void,
  onSettled: () => void,
  shouldContinue: () => boolean
): Promise<void> => {
  try {
    await room.client?.threadSupportPending;
    if (!shouldContinue()) return;
    await ensureThreadTimelineSets(room);
    if (!shouldContinue()) return;
    try {
      await room.fetchRoomThreads();
    } catch (err) {
      console.warn('[threadList] fetchRoomThreads failed:', err);
      return;
    }
    onProgress?.();

    if (!Thread.hasServerSideListSupport) return;

    const allThreadsLiveTimeline = getAllThreadsLiveTimeline(room);
    if (!allThreadsLiveTimeline) return;

    for (;;) {
      if (!shouldContinue()) return;
      const currentToken = allThreadsLiveTimeline.getPaginationToken(Direction.Backward);
      if (currentToken === null) return;

      const hasMore = await room.client.paginateEventTimeline(allThreadsLiveTimeline, {
        backwards: true,
      });
      onProgress?.();

      const nextToken = allThreadsLiveTimeline.getPaginationToken(Direction.Backward);
      if (!hasMore || nextToken === currentToken) {
        return;
      }
    }
  } finally {
    onSettled();
  }
};

export const loadRoomThreads = (
  room: Room,
  onProgress?: () => void,
  signal?: AbortSignal
): Promise<void> => {
  if (signal?.aborted) return Promise.resolve();

  let load = roomThreadListLoads.get(room);
  if (!load) {
    const consumers = new Map<symbol, (() => void) | undefined>();
    let activeLoad: RoomThreadListLoad;
    const promise = Promise.resolve().then(() =>
      loadRoomThreadsOnce(
        room,
        () => {
          consumers.forEach((listener) => {
            if (!listener) return;
            try {
              listener();
            } catch (err) {
              console.warn('[threadList] progress listener failed:', err);
            }
          });
        },
        () => {
          if (roomThreadListLoads.get(room) === activeLoad) {
            roomThreadListLoads.delete(room);
          }
        },
        () => consumers.size > 0
      )
    );
    activeLoad = {
      consumers,
      promise,
    };
    load = activeLoad;
    roomThreadListLoads.set(room, activeLoad);
  }

  const consumerId = Symbol('room-thread-list-consumer');
  load.consumers.set(consumerId, onProgress);
  const removeConsumer = () => {
    load.consumers.delete(consumerId);
  };
  signal?.addEventListener('abort', removeConsumer, { once: true });

  return load.promise.finally(() => {
    signal?.removeEventListener('abort', removeConsumer);
    removeConsumer();
  });
};
