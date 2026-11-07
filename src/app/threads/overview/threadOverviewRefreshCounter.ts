import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { MatrixEventEvent, RoomEvent, ThreadEvent } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { shouldRefreshOverviewForTimelineEvent } from '../open/threadBootstrap';

/**
 * A recompute key for the room's thread overview (chips, cards, reply counts, unread marks and
 * sort order), much of which comes from SDK thread objects and read receipts rather than from the
 * view's own timeline state.
 *
 * While no thread is open, the count goes up by one for every room timeline event that concerns a
 * thread (a root, a reply, or an event related to one of them), every read receipt of the room,
 * and every thread that is created, updated, deleted or gets a new reply. Such an event decrypting
 * later counts too, once per batch: until then a card can only show an older reply, and WebKit
 * often decrypts after the cards are drawn (P2-e2ee-F005). Inside a thread nothing
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

    // Optional calls: the rooms of some view tests carry a client stand-in without listeners.
    const client: Partial<Pick<MatrixClient, 'on' | 'removeListener'>> | undefined = room.client;
    let decryptedBump: ReturnType<typeof setTimeout> | undefined;
    const handleDecrypted = (mEvent: MatrixEvent) => {
      if (decryptedBump !== undefined || mEvent.getRoomId() !== room.roomId) return;
      if (!shouldRefreshOverviewForTimelineEvent(room, mEvent)) return;
      decryptedBump = setTimeout(() => {
        decryptedBump = undefined;
        bump();
      }, 0);
    };

    room.on(RoomEvent.Timeline, handleTimeline);
    room.on(RoomEvent.Receipt, handleReceipt);
    client?.on?.(MatrixEventEvent.Decrypted, handleDecrypted);
    room.on(ThreadEvent.New, bump);
    room.on(ThreadEvent.Update, bump);
    room.on(ThreadEvent.NewReply, bump);
    room.on(ThreadEvent.Delete, bump);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimeline);
      room.removeListener(RoomEvent.Receipt, handleReceipt);
      client?.removeListener?.(MatrixEventEvent.Decrypted, handleDecrypted);
      clearTimeout(decryptedBump);
      room.removeListener(ThreadEvent.New, bump);
      room.removeListener(ThreadEvent.Update, bump);
      room.removeListener(ThreadEvent.NewReply, bump);
      room.removeListener(ThreadEvent.Delete, bump);
    };
  }, [room, threadId]);

  return { overviewRefreshCounter, setOverviewRefreshCounter };
};
