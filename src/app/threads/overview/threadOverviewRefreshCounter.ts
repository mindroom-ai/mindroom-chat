import { useCallback, useLayoutEffect, useState } from 'react';
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
import type {
  EventTimelineSet,
  MatrixClient,
  MatrixEvent,
  Room,
  RoomMember,
  RoomState,
  Thread,
} from 'matrix-js-sdk';
import { shouldRefreshOverviewForTimelineEvent } from '../open/threadBootstrap';
import {
  createThreadRecordChanges,
  markThreadRecordChange,
  type ThreadRecordChanges,
} from '../../event-store/threads/threadRecord';
import { MAIN_ROOM_TIMELINE } from 'matrix-js-sdk/lib/@types/read_receipts';
import { isRecord } from '../../lib/isRecord';
import {
  threadRecordKeeperOf,
  threadRecordKept,
  type ThreadRecordKeeper,
} from './threadRecordKeeper';

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

/**
 * The threads an event of the room may change (`changedThreadId`), and the event itself when it
 * answers another message of the room: it may be a root. One `undefined` when the thread is
 * unknown, which stands for every thread of the room.
 */
export const changedThreadIds = (room: Room, mEvent: MatrixEvent): Array<string | undefined> => {
  const changedId = changedThreadId(room, mEvent);
  const eventId = mEvent.getId();
  const mayBeRoot = changedId && !mEvent.threadRootId && eventId && eventId !== changedId;
  return mayBeRoot ? [eventId, changedId] : [changedId];
};

/** How long a kept thread record waits for the mark of the room that has it built again. */
export const KEPT_RECORD_CHECK_MS = 1000;

/**
 * The threads the receipts of `userId` in a receipt event are for; a thread record reads no one
 * else's. Undefined when one of them is unthreaded or for the main timeline: such a receipt reads
 * the root of every thread, or all of each.
 */
export const receiptThreadIds = (receipt: MatrixEvent, userId: string): string[] | undefined => {
  const threadIds: string[] = [];
  const own = Object.values(receipt.getContent()).flatMap((byType) =>
    isRecord(byType)
      ? Object.values(byType).map((byUser) => isRecord(byUser) && byUser[userId])
      : []
  );
  for (const data of own) {
    if (!isRecord(data)) continue;
    if (typeof data.thread_id !== 'string' || data.thread_id === MAIN_ROOM_TIMELINE) {
      return undefined;
    }
    threadIds.push(data.thread_id);
  }
  return threadIds;
};

/**
 * Marks in `changes` what each event of `room` may change in its thread records, and calls
 * `target.count` for those that may change what its overview shows
 * (`useThreadOverviewRefreshCounter`). Both are read at each event. Without a count it only marks,
 * with no timer, no update of a view and no check of what a view would show: for the records a
 * room's page keeps while its list is gone (`target.maps`, `ThreadRecordKeeper`). It marks then
 * only the threads of those records and the whole room; a thread with no record kept is built
 * anew anyway. Its change still moves the count of marks, which tells a build made before it that
 * the room changed since. Returns the stop.
 */
const listenForThreadRecordChanges = (
  room: Room,
  changes: ThreadRecordChanges,
  target: Pick<ThreadRecordKeeper, 'count' | 'maps'>
): (() => void) => {
  const bump = () => target.count?.();
  const mark = (threadRootId?: string) => {
    if (!threadRootId || target.count || threadRecordKept(target, threadRootId)) {
      markThreadRecordChange(changes, threadRootId);
    } else {
      changes.count += 1;
    }
  };
  const markEvent = (mEvent: MatrixEvent) => changedThreadIds(room, mEvent).forEach(mark);
  const handleTimeline = (
    mEvent: MatrixEvent,
    eventRoom: Room | undefined,
    _toStartOfTimeline: boolean | undefined,
    removed: boolean
  ) => {
    if (eventRoom?.roomId !== room.roomId) return;
    markEvent(mEvent);
    if (!removed && target.count && shouldRefreshOverviewForTimelineEvent(room, mEvent)) bump();
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
      mark();
    } else {
      threadIds.forEach(mark);
    }
    oldestThreadedReceiptTs = oldest;
    bump();
  };
  // Without an ID it is no event of a timeline (typing, a receipt, account data).
  const handleRoomEvent = (mEvent: MatrixEvent) => {
    if (mEvent.getRoomId() === room.roomId && mEvent.getId()) markEvent(mEvent);
  };
  // By then the redacted event has left its thread, which the room names.
  const handleRedaction = (mEvent: MatrixEvent, _room: Room, threadRootId?: string) => {
    if (threadRootId) mark(threadRootId);
    markEvent(mEvent);
  };
  // A record names its people and reads who is in the room. The sync repeats member events that
  // change neither, one for the sender of many a batch.
  const handleMember = (_mEvent: MatrixEvent, member: RoomMember) => {
    if (member.roomId === room.roomId) mark();
  };
  // A record reads whether the room is encrypted.
  const handleState = (mEvent: MatrixEvent, state: RoomState) => {
    if (state.roomId === room.roomId && mEvent.getType() === (EventType.RoomEncryption as string)) {
      mark();
    }
  };
  // A thread's timeline that starts over (for its first page, or after a sync with a gap) shows
  // other events of that thread; the room's may have lost events of any. An event a receipt
  // names that the room lost this way is a change of the room's own (`receiptEventsVersion`).
  const handleReset = (_room: Room | undefined, timelineSet: EventTimelineSet) =>
    mark(timelineSet.thread?.id);
  const handleThread = (thread: Thread | undefined) => {
    mark(thread?.id);
    bump();
  };

  let decryptedBump: ReturnType<typeof setTimeout> | undefined;
  const handleDecrypted = (mEvent: MatrixEvent) => {
    if (mEvent.getRoomId() !== room.roomId) return;
    markEvent(mEvent);
    if (!target.count || decryptedBump !== undefined) return;
    if (!shouldRefreshOverviewForTimelineEvent(room, mEvent)) return;
    decryptedBump = setTimeout(() => {
      decryptedBump = undefined;
      bump();
    }, 0);
  };

  room.on(RoomEvent.Timeline, handleTimeline);
  room.on(RoomEvent.Receipt, handleReceipt);
  room.on(RoomEvent.LocalEchoUpdated, markEvent);
  room.on(RoomEvent.Redaction, handleRedaction);
  room.on(RoomEvent.TimelineReset, handleReset);
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
    room.removeListener(RoomEvent.LocalEchoUpdated, markEvent);
    room.removeListener(RoomEvent.Redaction, handleRedaction);
    room.removeListener(RoomEvent.TimelineReset, handleReset);
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
};

/**
 * A list of the keeper's room shows: the room's listener counts for it from now on, and starts
 * when none listens (the page's first list, or one after a list that left nothing to keep), with
 * a mark of the whole room for what happened before. Returns whether it heard the room all along
 * since the records the keeper keeps.
 */
const attachThreadRecordList = (keeper: ThreadRecordKeeper, count: () => void): boolean => {
  keeper.count = count;
  if (keeper.stop) return true;
  keeper.stop = listenForThreadRecordChanges(keeper.room, keeper.changes, keeper);
  markThreadRecordChange(keeper.changes);
  return false;
};

/** The list goes: the listener only marks while the keeper has records, and stops without. */
const detachThreadRecordList = (keeper: ThreadRecordKeeper): void => {
  keeper.count = undefined;
  if (keeper.maps) return;
  keeper.stop?.();
  keeper.stop = undefined;
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
 * progress, a redaction, a timeline that starts over (a thread's for that thread, the room's for
 * every thread), a member's new name or membership, and the room's encryption. Someone
 * else's receipt changes no record. A build that kept a record is followed within a second
 * (`KEPT_RECORD_CHECK_MS`) by a mark of the whole room and a count, for what no event tells of.
 *
 * With the room page's `keeper` (`ThreadRecordKeeper`) the marks are the keeper's, and so is the
 * listener: it starts with the first list of the room and goes on while no list shows, marking
 * without a count (`attachThreadRecordList`), until the page lets go of the room. A list that
 * mounts then marks nothing of the room, and its first build keeps every record nothing changed.
 */
export const useThreadOverviewRefreshCounter = (
  room: Room,
  threadId: string | undefined,
  keeper?: ThreadRecordKeeper
): {
  overviewRefreshCounter: number;
  setOverviewRefreshCounter: Dispatch<SetStateAction<number>>;
  overviewChanges: ThreadRecordChanges;
} => {
  const [overviewRefreshCounter, setCounter] = useState(0);
  const [ownChanges] = useState(createThreadRecordChanges);
  const kept = threadRecordKeeperOf(keeper, room);
  const overviewChanges = kept ? kept.changes : ownChanges;
  // The marks this render's build saw (`useThreadIndex` builds in the same render).
  const renderedAt = overviewChanges.count;
  const setOverviewRefreshCounter = useCallback<Dispatch<SetStateAction<number>>>(
    (count) => {
      markThreadRecordChange(overviewChanges);
      setCounter(count);
    },
    [overviewChanges]
  );

  // From the commit, before the first paint: no change after it goes without a count.
  useLayoutEffect(() => {
    if (threadId) return undefined;

    // A mark between the build and this commit (a render React let wait, a list that comes back
    // before it listens) counts now, before paint, as any change does.
    const missed = overviewChanges.count !== renderedAt;
    const bump = () => setCounter((count) => count + 1);
    // What no event of the room tells of reaches a kept record within a second: a store that
    // drops its oldest entries, a stream that ends by the clock, an old name of a member who left
    // that a page of history brings. The build that follows keeps no record, so a quiet room
    // counts once more and then rests.
    let keptCheck: ReturnType<typeof setTimeout> | undefined;
    overviewChanges.onKept = () => {
      keptCheck ??= setTimeout(() => {
        keptCheck = undefined;
        markThreadRecordChange(overviewChanges);
        bump();
      }, KEPT_RECORD_CHECK_MS);
    };
    let stop: () => void;
    if (kept) {
      // The first build kept the records of the list that went, before anyone listened.
      if (attachThreadRecordList(kept, bump)) overviewChanges.onKept();
      stop = () => detachThreadRecordList(kept);
    } else {
      // What happened to the room before these listeners heard it.
      markThreadRecordChange(overviewChanges);
      stop = listenForThreadRecordChanges(room, overviewChanges, { count: bump, maps: undefined });
    }
    if (missed) bump();
    return () => {
      stop();
      clearTimeout(keptCheck);
      overviewChanges.onKept = undefined;
    };
    // Only the commit that starts the listeners reads `renderedAt`: later ones count as they hear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, threadId, overviewChanges, kept]);

  return { overviewRefreshCounter, setOverviewRefreshCounter, overviewChanges };
};
