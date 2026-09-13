/* eslint-disable no-console */

import { Direction } from 'matrix-js-sdk/lib/models/event-timeline';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { Thread } from 'matrix-js-sdk/lib/models/thread';
import { isVisibleThreadReplyEvent } from './threadUtils';

const getLatestVisibleReply = (thread: Thread) =>
  [...(thread.events ?? [])].reverse().find(isVisibleThreadReplyEvent) ??
  (thread.replyToEvent && isVisibleThreadReplyEvent(thread.replyToEvent)
    ? thread.replyToEvent
    : undefined);

export const getThreadLastActivityTs = (thread: Thread): number =>
  getLatestVisibleReply(thread)?.getTs() ?? thread.rootEvent?.getTs() ?? 0;

/**
 * Check if a single thread has unread messages.
 * A thread is unread when its latest reply is from another user
 * and is newer than the room-level read receipt.
 */
export const getThreadUnread = (
  room: Room,
  thread: Thread,
  userId: string
): boolean => {
  const latestReply = getLatestVisibleReply(thread);
  if (!latestReply) return false;

  if (latestReply.getSender() === userId) return false;

  const readUpToId = room.getEventReadUpTo(userId);
  if (!readUpToId) return true;
  const readUpToEvent = room.findEventById(readUpToId);
  if (!readUpToEvent) return true;

  return latestReply.getTs() > readUpToEvent.getTs();
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
  await ensureThreadTimelineSets(room);
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
};
