import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { RoomEvent, ThreadEvent } from 'matrix-js-sdk';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { shouldRefreshOverviewForTimelineEvent } from './threadBootstrap';

/**
 * A recompute key for the room's thread overview (chips, cards, reply counts, unread marks and
 * sort order), much of which comes from SDK thread objects and read receipts rather than from the
 * view's own timeline state.
 *
 * While no thread is open, the count goes up by one for every room timeline event that concerns a
 * thread (a root, a reply, or an event related to one of them), every read receipt of the room,
 * and every thread that is created, updated, deleted or gets a new reply. Inside a thread nothing
 * listens and the count keeps its value. The listeners change only with the room or the thread:
 * the setter, which callers also use to ask for a recompute, keeps its identity.
 */
export const useThreadOverviewRefreshCounter = (
  room: Room,
  threadId: string | undefined
): {
  overviewRefreshCounter: number;
  setOverviewRefreshCounter: Dispatch<SetStateAction<number>>;
} => {
  const [overviewRefreshCounter, setOverviewRefreshCounter] = useState(0);

  useEffect(() => {
    if (threadId) return undefined;

    const bump = () => setOverviewRefreshCounter((count) => count + 1);
    const handleTimeline = (
      mEvent: MatrixEvent,
      eventRoom: Room | undefined,
      _toStartOfTimeline: boolean | undefined,
      removed: boolean
    ) => {
      if (removed || eventRoom?.roomId !== room.roomId) return;
      if (shouldRefreshOverviewForTimelineEvent(room, mEvent)) bump();
    };
    const handleReceipt = (_receipt: MatrixEvent, receiptRoom: Room | undefined) => {
      if (receiptRoom?.roomId === room.roomId) bump();
    };

    room.on(RoomEvent.Timeline, handleTimeline);
    room.on(RoomEvent.Receipt, handleReceipt);
    room.on(ThreadEvent.New, bump);
    room.on(ThreadEvent.Update, bump);
    room.on(ThreadEvent.NewReply, bump);
    room.on(ThreadEvent.Delete, bump);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimeline);
      room.removeListener(RoomEvent.Receipt, handleReceipt);
      room.removeListener(ThreadEvent.New, bump);
      room.removeListener(ThreadEvent.Update, bump);
      room.removeListener(ThreadEvent.NewReply, bump);
      room.removeListener(ThreadEvent.Delete, bump);
    };
  }, [room, threadId]);

  return { overviewRefreshCounter, setOverviewRefreshCounter };
};
