import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  ClientEvent,
  EventType,
  MatrixEventEvent,
  RoomEvent,
  RoomMemberEvent,
  RoomStateEvent,
  ThreadEvent,
} from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room, RoomMember, RoomState, Thread } from 'matrix-js-sdk';
import { shouldRefreshOverviewForTimelineEvent } from '../open/threadBootstrap';
import {
  createThreadRecordChanges,
  markThreadRecordChange,
  type ThreadRecordChanges,
} from '../../event-store/threads/threadRecord';
import { MAIN_ROOM_TIMELINE } from 'matrix-js-sdk/lib/@types/read_receipts';
import { isRecord } from '../../lib/isRecord';

/**
 * The thread whose record an event of the room may change: the thread it is in, else the thread
 * of the event it relates to, else that event or itself, either of which may be a root. Undefined
 * when it relates to an event the room does not hold, whose thread is then unknown.
 */
const changedThreadId = (room: Room, mEvent: MatrixEvent): string | undefined => {
  if (mEvent.threadRootId) return mEvent.threadRootId;
  const relatedId = mEvent.getAssociatedId() ?? mEvent.getRelation()?.event_id;
  if (!relatedId) return mEvent.getId();
  const related = room.findEventById(relatedId);
  return related && (related.threadRootId ?? relatedId);
};

/** How often a count marks the whole room for what no event tells of. */
export const ROOM_MARK_INTERVAL_MS = 1000;

/**
 * The threads the receipts of `userId` in a receipt event are for; a thread record reads no one
 * else's. Undefined when one of them is unthreaded or for the main timeline: such a receipt reads
 * the root of every thread, or all of each.
 */
const receiptThreadIds = (receipt: MatrixEvent, userId: string): string[] | undefined => {
  const threadIds: string[] = [];
  const own = Object.values(receipt.getContent()).flatMap((byType) =>
    isRecord(byType)
      ? Object.values(byType).map((byUser) => isRecord(byUser) && byUser[userId])
      : []
  );
  for (const data of own) {
    if (isRecord(data)) {
      if (typeof data.thread_id !== 'string' || data.thread_id === MAIN_ROOM_TIMELINE) {
        return undefined;
      }
      threadIds.push(data.thread_id);
    }
  }
  return threadIds;
};

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
 *
 * `overviewChanges` says what each count may have changed, for the thread records kept from one
 * count to the next (`ThreadRecordReuse`): the thread of the event, thread update or reader's
 * thread receipt, or the whole room (the reader's other receipts, a caller's request, an event
 * whose thread is unknown). It also
 * takes what a record reads that raises no count: every event the client hears of the room (the
 * edits kept from the sync are in by then), an edit put on or taken off an event, a local echo's
 * progress, a redaction, a member's new name or membership, and the room's encryption. Someone
 * else's receipt changes no record. The first count of each second marks the whole room
 * (`ROOM_MARK_INTERVAL_MS`), for what no event tells of.
 */
export const useThreadOverviewRefreshCounter = (
  room: Room,
  threadId: string | undefined
): {
  overviewRefreshCounter: number;
  setOverviewRefreshCounter: Dispatch<SetStateAction<number>>;
  overviewChanges: ThreadRecordChanges;
} => {
  const [overviewRefreshCounter, setCounter] = useState(0);
  const [overviewChanges] = useState(createThreadRecordChanges);
  const setOverviewRefreshCounter = useCallback<Dispatch<SetStateAction<number>>>(
    (count) => {
      markThreadRecordChange(overviewChanges);
      setCounter(count);
    },
    [overviewChanges]
  );

  useEffect(() => {
    if (threadId) return undefined;

    // What happened to the room before these listeners heard it.
    markThreadRecordChange(overviewChanges);
    // What no event of the room tells of reaches the records at the first count of each second:
    // a store that drops its oldest entries, a stream that ends by the clock, an old name of a
    // member who left that a page of history brings.
    let roomMarkedAt = Date.now();
    const bump = () => {
      const now = Date.now();
      if (now - roomMarkedAt >= ROOM_MARK_INTERVAL_MS) {
        roomMarkedAt = now;
        markThreadRecordChange(overviewChanges);
      }
      setCounter((count) => count + 1);
    };
    const markEvent = (mEvent: MatrixEvent) => {
      const threadId = changedThreadId(room, mEvent);
      const eventId = mEvent.getId();
      // A message of the room that answers another one may be a root itself.
      if (threadId && !mEvent.threadRootId && eventId && eventId !== threadId) {
        markThreadRecordChange(overviewChanges, eventId);
      }
      markThreadRecordChange(overviewChanges, threadId);
    };
    const handleTimeline = (
      mEvent: MatrixEvent,
      eventRoom: Room | undefined,
      _toStartOfTimeline: boolean | undefined,
      removed: boolean
    ) => {
      if (eventRoom?.roomId !== room.roomId) return;
      markEvent(mEvent);
      if (!removed && shouldRefreshOverviewForTimelineEvent(room, mEvent)) bump();
    };
    // Optional calls: the rooms of some view tests carry a client stand-in without listeners.
    const client: Partial<Pick<MatrixClient, 'on' | 'removeListener' | 'getUserId'>> | undefined =
      room.client;
    // The reader's first receipt in a thread, or one older than the others, changes how the SDK
    // reads every thread of the room (`getThreadEventReadUpTo`).
    let oldestThreadedReceiptTs = room.getOldestThreadedReceiptTs?.();
    const handleReceipt = (receipt: MatrixEvent | undefined, receiptRoom: Room | undefined) => {
      if (receiptRoom?.roomId !== room.roomId) return;
      const userId = client?.getUserId?.();
      const threadIds = userId && receipt ? receiptThreadIds(receipt, userId) : undefined;
      const oldest = room.getOldestThreadedReceiptTs?.();
      if (!threadIds || oldest !== oldestThreadedReceiptTs) {
        markThreadRecordChange(overviewChanges);
      } else {
        threadIds.forEach((id) => markThreadRecordChange(overviewChanges, id));
      }
      oldestThreadedReceiptTs = oldest;
      bump();
    };
    // Without an ID it is no event of a timeline (typing, a receipt, account data).
    const handleRoomEvent = (mEvent: MatrixEvent) => {
      if (mEvent.getRoomId() === room.roomId && mEvent.getId()) markEvent(mEvent);
    };
    const handleEcho = (mEvent: MatrixEvent) => markEvent(mEvent);
    // By then the redacted event has left its thread, which the room names.
    const handleRedaction = (mEvent: MatrixEvent, _room: Room, threadRootId?: string) => {
      if (threadRootId) markThreadRecordChange(overviewChanges, threadRootId);
      markEvent(mEvent);
    };
    // A record names its people and reads who is in the room, and whether the room is encrypted.
    // The sync repeats member events that change neither, one for the sender of many a batch.
    const handleMember = (_mEvent: MatrixEvent, member: RoomMember) => {
      if (member.roomId === room.roomId) markThreadRecordChange(overviewChanges);
    };
    const handleState = (mEvent: MatrixEvent, state: RoomState) => {
      if (
        state.roomId === room.roomId &&
        mEvent.getType() === (EventType.RoomEncryption as string)
      ) {
        markThreadRecordChange(overviewChanges);
      }
    };
    const handleThread = (thread: Thread | undefined) => {
      markThreadRecordChange(overviewChanges, thread?.id);
      bump();
    };

    let decryptedBump: ReturnType<typeof setTimeout> | undefined;
    const handleDecrypted = (mEvent: MatrixEvent) => {
      if (mEvent.getRoomId() !== room.roomId) return;
      markEvent(mEvent);
      if (decryptedBump !== undefined) return;
      if (!shouldRefreshOverviewForTimelineEvent(room, mEvent)) return;
      decryptedBump = setTimeout(() => {
        decryptedBump = undefined;
        bump();
      }, 0);
    };

    room.on(RoomEvent.Timeline, handleTimeline);
    room.on(RoomEvent.Receipt, handleReceipt);
    room.on(RoomEvent.LocalEchoUpdated, handleEcho);
    room.on(RoomEvent.Redaction, handleRedaction);
    client?.on?.(MatrixEventEvent.Decrypted, handleDecrypted);
    client?.on?.(ClientEvent.Event, handleRoomEvent);
    client?.on?.(MatrixEventEvent.Replaced, handleRoomEvent);
    client?.on?.(RoomStateEvent.Events, handleState);
    client?.on?.(RoomMemberEvent.Name, handleMember);
    client?.on?.(RoomMemberEvent.Membership, handleMember);
    room.on(ThreadEvent.New, handleThread);
    room.on(ThreadEvent.Update, handleThread);
    room.on(ThreadEvent.NewReply, handleThread);
    room.on(ThreadEvent.Delete, handleThread);
    return () => {
      room.removeListener(RoomEvent.Timeline, handleTimeline);
      room.removeListener(RoomEvent.Receipt, handleReceipt);
      room.removeListener(RoomEvent.LocalEchoUpdated, handleEcho);
      room.removeListener(RoomEvent.Redaction, handleRedaction);
      client?.removeListener?.(MatrixEventEvent.Decrypted, handleDecrypted);
      client?.removeListener?.(ClientEvent.Event, handleRoomEvent);
      client?.removeListener?.(MatrixEventEvent.Replaced, handleRoomEvent);
      client?.removeListener?.(RoomStateEvent.Events, handleState);
      client?.removeListener?.(RoomMemberEvent.Name, handleMember);
      client?.removeListener?.(RoomMemberEvent.Membership, handleMember);
      clearTimeout(decryptedBump);
      room.removeListener(ThreadEvent.New, handleThread);
      room.removeListener(ThreadEvent.Update, handleThread);
      room.removeListener(ThreadEvent.NewReply, handleThread);
      room.removeListener(ThreadEvent.Delete, handleThread);
    };
  }, [room, threadId, overviewChanges]);

  return { overviewRefreshCounter, setOverviewRefreshCounter, overviewChanges };
};
