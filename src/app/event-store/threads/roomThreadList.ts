/* eslint-disable no-console */

import { Direction } from 'matrix-js-sdk/lib/models/event-timeline';
import { ReceiptType } from 'matrix-js-sdk/lib/@types/read_receipts';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { Thread } from 'matrix-js-sdk/lib/models/thread';
import { unthreadedReceiptReadTs } from '../../matrix/receiptReadTs';
import { isThreadSummaryEvent } from '../../matrix/protocol/threadSummary';
import { isVisibleThreadReplyEvent } from './threadUtils';
import { getThreadEventReadUpTo } from './threadEventReadUpTo';
import { getFinishingEdit, threadReceiptNamesEvent } from './streamFinish';
import { createThreadListRetry, type ThreadListRetry } from './threadListRetry';

/**
 * The newest reply of the thread that `matches`. A thread that has not loaded its latest page
 * knows its newest reply from the root's summary.
 */
const getLatestReply = (
  thread: Thread,
  matches: (event: MatrixEvent) => boolean
): MatrixEvent | undefined => {
  const loaded = (thread.events ?? []).findLast(matches);
  const summary = thread.replyToEvent;
  if (!summary || !matches(summary)) return loaded;
  return loaded && loaded.getTs() >= summary.getTs() ? loaded : summary;
};

export const getLatestVisibleReply = (thread: Thread): MatrixEvent | undefined =>
  getLatestReply(thread, isVisibleThreadReplyEvent);

/**
 * A reply that can leave its thread unread: not an agent's title notice, which never counts
 * (design decision #17), as the server never counts one in a room it can read (Tuwunel #149).
 */
const isUnreadWorthyReply = (event: MatrixEvent): boolean =>
  isVisibleThreadReplyEvent(event) && !isThreadSummaryEvent(event);

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
  const readUpToId = getThreadEventReadUpTo(thread, userId);
  const readEventIds = new Set([readUpToId]);
  for (const receiptType of [ReceiptType.Read, ReceiptType.ReadPrivate]) {
    // A retained local echo can mask a newer server receipt outside the timeline.
    for (const ignoreSynthesized of [false, true]) {
      const receipt = thread.getReadReceiptForUserId(userId, ignoreSynthesized, receiptType);
      if (receipt && receipt.data.thread_id === thread.id) readEventIds.add(receipt.eventId);
    }
  }
  let readUpToTs = unthreadedReceiptReadTs(thread.room, userId, thread);
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

export const getThreadLastActivityTs = (thread: Thread): number =>
  getLatestVisibleReply(thread)?.getTs() ?? thread.rootEvent?.getTs() ?? 0;

/**
 * A thread is unread when its latest reply, not counting title notices (`isUnreadWorthyReply`), is
 * from another user and newer than the user's thread or unthreaded receipt; a main-timeline receipt
 * reads no replies. A streamed reply is as new as the edit that finished it, which a receipt naming
 * it reads.
 */
export const getThreadUnread = (thread: Thread, userId: string): boolean => {
  const latestReply = getLatestReply(thread, isUnreadWorthyReply);
  if (!latestReply || latestReply.getSender() === userId) return false;
  const finish = getFinishingEdit(latestReply, thread);
  const finishId = finish?.getId();
  if (finishId && threadReceiptNamesEvent(thread, userId, finishId)) return false;
  const readState = getThreadReadState(thread, userId);
  const readUpToTs = readState?.readUpToTs;
  // The finishing edit comes after its reply, though both may carry the same timestamp.
  const readUpToReply =
    !!finish &&
    readUpToTs === latestReply.getTs() &&
    !!readState?.readEventIds.has(latestReply.getId() ?? '');
  return readUpToTs === undefined || (finish ?? latestReply).getTs() > readUpToTs || readUpToReply;
};

/**
 * Return a Map of threadRootId → boolean for all given threads,
 * indicating which have unread messages.
 */
export const getRoomThreadsUnread = (threads: Thread[], userId: string): Map<string, boolean> =>
  new Map(threads.map((thread) => [thread.id, getThreadUnread(thread, userId)]));

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
  wake: () => void;
};

const roomThreadListLoads = new WeakMap<Room, RoomThreadListLoad>();
/** Rooms whose list has its first page; before it, the room knows only what sync and the cache showed. */
const listedRooms = new WeakSet<Room>();

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
  if (!listedRooms.has(room)) return false;

  const allThreadsLiveTimeline = getAllThreadsLiveTimeline(room);
  if (!allThreadsLiveTimeline) return true;

  return allThreadsLiveTimeline.getPaginationToken(Direction.Backward) === null;
};

/** The room's whole thread list arrived this session, so its threads hold the server's summaries. */
export const roomThreadListIsListed = (room: Room): boolean =>
  listedRooms.has(room) && roomThreadListIsComplete(room);

const loadRoomThreadsOnce = async (
  room: Room,
  onProgress: () => void,
  onSettled: () => void,
  shouldContinue: () => boolean,
  retry: ThreadListRetry
): Promise<void> => {
  // The list answers for the streaming replies of the threads it lists.
  const releaseStreamingChecks = retry.holdStreamingChecks();
  try {
    await room.client?.threadSupportPending;
    if (!shouldContinue()) return;
    await ensureThreadTimelineSets(room);
    if (!shouldContinue()) return;
    for (;;) {
      try {
        await room.fetchRoomThreads();
        break;
      } catch (err) {
        const retrying = retry.after(err, null);
        if (!retrying) {
          console.warn('[threadList] fetchRoomThreads failed:', err);
          return;
        }
        if (!(await retrying)) return;
      }
    }
    listedRooms.add(room);
    onProgress?.();

    if (!Thread.hasServerSideListSupport) return;

    const allThreadsLiveTimeline = getAllThreadsLiveTimeline(room);
    if (!allThreadsLiveTimeline) return;

    for (;;) {
      if (!shouldContinue()) return;
      const currentToken = allThreadsLiveTimeline.getPaginationToken(Direction.Backward);
      if (currentToken === null) return;

      let hasMore: boolean;
      try {
        hasMore = await room.client.paginateEventTimeline(allThreadsLiveTimeline, {
          backwards: true,
        });
      } catch (err) {
        const retrying = retry.after(err, currentToken);
        if (!retrying) throw err;
        if (!(await retrying)) return;
        continue;
      }
      onProgress?.();

      const nextToken = allThreadsLiveTimeline.getPaginationToken(Direction.Backward);
      if (!hasMore || nextToken === currentToken) {
        return;
      }
    }
  } finally {
    releaseStreamingChecks();
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
    const retry = createThreadListRetry(room, () => consumers.size > 0);
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
        () => consumers.size > 0,
        retry
      )
    );
    activeLoad = {
      consumers,
      promise,
      wake: retry.wake,
    };
    load = activeLoad;
    roomThreadListLoads.set(room, activeLoad);
  }

  const consumerId = Symbol('room-thread-list-consumer');
  load.consumers.set(consumerId, onProgress);
  load.wake();
  const removeConsumer = () => {
    load.consumers.delete(consumerId);
    if (load.consumers.size === 0) load.wake();
  };
  signal?.addEventListener('abort', removeConsumer, { once: true });

  return load.promise.finally(() => {
    signal?.removeEventListener('abort', removeConsumer);
    removeConsumer();
  });
};
