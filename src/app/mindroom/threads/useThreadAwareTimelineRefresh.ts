import { useEffect, useState } from 'react';
import { RoomEvent, type Room, type RoomEventHandlerMap } from 'matrix-js-sdk';
import { isLocalEchoEventId } from './threadRouteUtils';

/** Thread refresh bookkeeping, shared by every listener the hook registers. */
type ThreadRefreshQueue = {
  /** Threads whose refresh has started and not settled yet. */
  running: Set<string>;
  /** The thread that refreshes once more when its running refresh settles. */
  rerun: string | undefined;
  /** The thread the newest render shows. */
  shown: string | undefined;
  /** The newest refresh function, which reruns use too. */
  refresh: (threadId: string) => Promise<boolean>;
};

/**
 * Refreshes `threadId` and, when a signal for it arrived meanwhile and the thread is still shown,
 * once more after that. A refresh that fails settles like one that finished: its error is the
 * refresh's own to report, and the next signal tries again.
 */
const startThreadRefresh = (queue: ThreadRefreshQueue, threadId: string): void => {
  queue.running.add(threadId);
  const settle = () => {
    queue.running.delete(threadId);
    if (queue.rerun !== threadId) return;
    queue.rerun = undefined;
    if (queue.shown === threadId) startThreadRefresh(queue, threadId);
  };
  queue.refresh(threadId).then(settle, settle);
};

/**
 * Follows the SDK replacing the room's live timeline (`RoomEvent.TimelineRefresh`): an open
 * thread reloads its newest slice, one refresh at a time per thread, with the signals that
 * arrive during one folded into a single rerun; the room view rebuilds its window at the live
 * end, unless the reader is in older history that does not reach it.
 */
export const useThreadAwareTimelineRefresh = ({
  room,
  threadId,
  liveTimelineLinked,
  refreshLatestThreadSlice,
  onRoomRefresh,
}: {
  liveTimelineLinked: boolean;
  onRoomRefresh: () => void;
  refreshLatestThreadSlice: (threadId: string) => Promise<boolean>;
  room: Room;
  threadId?: string;
}): void => {
  const [queue] = useState<ThreadRefreshQueue>(() => ({
    running: new Set(),
    rerun: undefined,
    shown: threadId,
    refresh: refreshLatestThreadSlice,
  }));

  // Another thread, or none: a rerun queued for the previous thread is dropped in this very
  // render, so a refresh that settles later starts nothing.
  if (queue.shown !== threadId) {
    queue.shown = threadId;
    queue.rerun = undefined;
  }

  // Unmounting drops a queued rerun too: nothing starts after the view is gone.
  useEffect(
    () => () => {
      queue.rerun = undefined;
    },
    [queue]
  );

  useEffect(() => {
    queue.refresh = refreshLatestThreadSlice;
    const signal = RoomEvent.TimelineRefresh;
    const followRefresh: RoomEventHandlerMap[typeof signal] = (refreshedRoom) => {
      if (refreshedRoom.roomId !== room.roomId) return;
      if (!threadId) {
        if (liveTimelineLinked) onRoomRefresh();
        return;
      }
      // The server has not confirmed the thread root yet, so there is nothing to reload.
      if (isLocalEchoEventId(threadId)) return;
      if (queue.running.has(threadId)) {
        queue.rerun = threadId;
        return;
      }
      startThreadRefresh(queue, threadId);
    };
    room.on(signal, followRefresh);
    return () => {
      room.removeListener(signal, followRefresh);
    };
  }, [queue, room, threadId, liveTimelineLinked, refreshLatestThreadSlice, onRoomRefresh]);
};
