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
import {
  createThreadRecordChanges,
  markThreadRecordChange,
  type ThreadRecordChanges,
} from '../../event-store/threads/threadRecord';
import { MAIN_ROOM_TIMELINE } from 'matrix-js-sdk/lib/@types/read_receipts';
import { isRecord } from '../../lib/isRecord';
import { onSyncedEditForgotten } from '../../matrix/client/syncedEdits';
import { getThreadSummaryReply } from '../../matrix/client/unopenedThreadEdits';
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
 * Marks in `changes` what each event of `room` may change in its thread records
 * (`useThreadOverviewRefreshCounter`), and while `target.count` is given counts every mark: a
 * mark no count follows is a record kept as it was, in a room where nothing more happens. Both are
 * read at each event. Without a count it only marks, with no timer and no update of a view: for
 * the records a room's page keeps while its list is gone (`target.maps`, `ThreadRecordKeeper`). It
 * marks then only the threads of those records and the whole room; a thread with no record kept is
 * built anew anyway. Its change still moves the count of marks, which tells a build made before it
 * that the room changed since. While it listens, `changes.listened` says so. Returns the stop.
 */
const listenForThreadRecordChanges = (
  room: Room,
  changes: ThreadRecordChanges,
  target: Pick<ThreadRecordKeeper, 'count' | 'maps'>
): (() => void) => {
  const bump = () => target.count?.();
  const markOnly = (threadRootId?: string) => {
    if (!threadRootId || target.count || threadRecordKept(target, threadRootId)) {
      markThreadRecordChange(changes, threadRootId);
    } else {
      changes.count += 1;
    }
  };
  const mark = (threadRootId?: string) => {
    markOnly(threadRootId);
    bump();
  };
  const markEvent = (mEvent: MatrixEvent) => changedThreadIds(room, mEvent).forEach(mark);
  // Also a message outside any thread: it may be the event a receipt names, which moves how far
  // that receipt reads in every thread once the room holds it (`receiptEventsVersion`).
  const handleTimeline = (mEvent: MatrixEvent, eventRoom: Room | undefined) => {
    if (eventRoom?.roomId !== room.roomId) return;
    markEvent(mEvent);
    // A record names a member who left by their newest member event the room has loaded
    // (`getMemberDisplayName`), which a page of history may bring; no member changes then.
    if (mEvent.getType() === (EventType.RoomMember as string)) mark();
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
      markOnly();
    } else {
      threadIds.forEach(markOnly);
    }
    oldestThreadedReceiptTs = oldest;
    // Once, also for someone else's receipt, which marks nothing.
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
  // change neither, one for the sender of many a batch. A change often comes without an event of
  // a timeline: the room's member list, loaded late, may bring a second member of one name.
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
  // The kept edits a record read of a message are gone: no event tells of it. The message is in
  // a timeline, or the reply an unopened thread's summary names, or else perhaps a root no
  // timeline holds (a pinned one), whose record goes by its own ID. The store is every room's:
  // while no list shows, a message it drops is a change of the whole room, found without a look.
  const stopForgotten = onSyncedEditForgotten((messageId) => {
    if (!target.count) {
      markOnly();
      return;
    }
    const held =
      room.findEventById(messageId) ??
      room
        .getThreads()
        .map(getThreadSummaryReply)
        .find((reply) => reply?.getId() === messageId);
    if (held) markEvent(held);
    else mark(messageId);
  });
  // The room's thread list reads the room's threads again with this count (`useRoomThreadList`).
  const handleThread = (thread: Thread | undefined) => {
    changes.threadList += 1;
    mark(thread?.id);
  };

  // The events of a batch decrypt one by one: they are marked at once and counted once.
  let decryptedBump: ReturnType<typeof setTimeout> | undefined;
  const handleDecrypted = (mEvent: MatrixEvent) => {
    if (mEvent.getRoomId() !== room.roomId) return;
    changedThreadIds(room, mEvent).forEach(markOnly);
    if (!target.count) return;
    decryptedBump ??= setTimeout(() => {
      decryptedBump = undefined;
      bump();
    }, 0);
  };

  changes.listened = true;
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
    changes.listened = false;
    stopForgotten();
    room.removeListener(ThreadEvent.New, handleThread);
    room.removeListener(ThreadEvent.Update, handleThread);
    room.removeListener(ThreadEvent.NewReply, handleThread);
    room.removeListener(ThreadEvent.Delete, handleThread);
  };
};

/**
 * A list of the keeper's room shows: the room's listener counts for it from now on, and starts
 * when none listens (the page's first list, or one after a list that left nothing to keep), with
 * a mark of the whole room for what happened before.
 */
const attachThreadRecordList = (keeper: ThreadRecordKeeper, count: () => void): void => {
  keeper.count = count;
  if (keeper.stop) return;
  markThreadRecordChange(keeper.changes);
  keeper.stop = listenForThreadRecordChanges(keeper.room, keeper.changes, keeper);
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
 * While no thread is open, the count goes up for everything that may change what the overview
 * shows of the room: every event a timeline of the room takes or loses and every event the client
 * hears of the room (the edits kept from the sync are in by then), an edit put on or taken off an
 * event, a local echo's progress, a redaction, a timeline that starts over, every read receipt of
 * the room, every thread that is created, updated, deleted or gets a new reply (a reply that stops
 * streaming by the clock, or that the streaming checks forget, comes as such an update:
 * streamingReplies.ts), a member's new name or membership, the room's encryption, and a message
 * whose kept edits a full store drops (`onSyncedEditForgotten`). An event that decrypts later
 * counts too, once per batch: until then a card can only show an older reply, and WebKit often
 * decrypts after the cards are drawn (P2-e2ee-F005). Inside a thread nothing listens and the count
 * keeps its value. The listeners change only with the room or the thread: the setter, which
 * callers also use to ask for a recompute, keeps its identity.
 *
 * `overviewChanges` says what each count may have changed, for the thread records kept from one
 * count to the next (`ThreadRecordReuse`): the thread of the event, thread update, dropped message
 * or reader's thread receipt, or the whole room (the reader's other receipts, a caller's request,
 * an event whose thread is unknown, the room's own timeline that starts over, a member's change
 * or a member event a timeline takes, which may bring the name a member had before they left, and
 * the room's encryption). Someone else's receipt changes no record. Every mark comes with a
 * count: a mark alone would leave the record as it was until something else counted. While these
 * listeners hear the room, `overviewChanges.listened` says so.
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
    // before it listens) may be of a record the build kept or made, which the marks of a list
    // that is gone do not tell apart: every record is built again before paint.
    const missed = overviewChanges.count !== renderedAt;
    const bump = () => setCounter((count) => count + 1);
    let stop: () => void;
    if (kept) {
      attachThreadRecordList(kept, bump);
      stop = () => detachThreadRecordList(kept);
    } else {
      // What happened to the room before these listeners heard it.
      markThreadRecordChange(overviewChanges);
      stop = listenForThreadRecordChanges(room, overviewChanges, { count: bump, maps: undefined });
    }
    if (missed) {
      markThreadRecordChange(overviewChanges);
      bump();
    }
    return stop;
    // Only the commit that starts the listeners reads `renderedAt`: later ones count as they hear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, threadId, overviewChanges, kept]);

  return { overviewRefreshCounter, setOverviewRefreshCounter, overviewChanges };
};
