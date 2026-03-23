import { Direction } from 'matrix-js-sdk/lib/models/event-timeline';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { Thread } from 'matrix-js-sdk/lib/models/thread';

export const getThreadLastActivityTs = (thread: Thread): number =>
  thread.replyToEvent?.getTs() ?? thread.rootEvent?.getTs() ?? 0;

export const sortThreadsByActivity = (threads: Thread[]): Thread[] =>
  [...threads].sort(
    (threadA, threadB) => getThreadLastActivityTs(threadB) - getThreadLastActivityTs(threadA)
  );

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

  while (true) {
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
