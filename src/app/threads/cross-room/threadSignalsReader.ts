import {
  ClientEvent,
  MatrixEventEvent,
  NotificationCountType,
  RoomEvent,
  RoomMemberEvent,
} from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import type { CrossRoomThreadIndexEntry } from './crossRoomThreadIndex';
import {
  createThreadRecordChanges,
  markThreadRecordChange,
  type ThreadRecordChanges,
} from '../../event-store/threads/threadRecord';
import { receiptEventsVersion } from '../../matrix/receiptReadTs';
import { seenThreadRootsVersion } from '../../matrix/seenThreadRoots';
import { changedThreadId, receiptThreadIds } from '../overview/threadOverviewRefreshCounter';
import { readThreadSignals, type ThreadSignals } from './threadSignals';

type Cached = { key: string; signals: ThreadSignals };

export type ThreadSignalsReader = {
  /** The thread's signals, read again only when something they depend on changed. */
  read: (
    room: Room,
    entry: CrossRoomThreadIndexEntry,
    userId: string,
    now: number
  ) => ThreadSignals;
  /** Forgets every thread whose index key `keep` does not hold. */
  prune: (keep: ReadonlySet<string>) => void;
};

/**
 * A cache of thread signals. The index entry's `generation` tells of what the entry shows: the
 * thread's summary and root as the server gave them, its tags, whether the user takes part. The
 * signals depend on more than that: a reaction, an edit the thread holds back, a receipt from
 * another device. So a thread is read again whenever something was heard that it may show
 * (`threadChanges`, a count that goes up for the thread), and once what it waits on lapses
 * (`waitsUntil`).
 */
export const createThreadSignalsReader = (
  threadChanges: (room: Room, threadRootId: string) => number = () => 0
): ThreadSignalsReader => {
  const cache = new Map<string, Cached>();
  return {
    read: (room, entry, userId, now) => {
      const events = room.getThread(entry.threadRootId)?.events ?? [];
      const key = [
        entry.generation,
        threadChanges(room, entry.threadRootId),
        // A root this device took for read, which sends no receipt and so no room event.
        seenThreadRootsVersion(),
        // An event a receipt names that the room came to hold or lost: the receipt reads up to it.
        receiptEventsVersion(room),
        // The server's count of the thread's mentions, which a sync changes with no event.
        room.getThreadUnreadNotificationCount(entry.threadRootId, NotificationCountType.Highlight),
        events.length,
        events.at(-1)?.getId() ?? '',
      ].join(':');
      const previous = cache.get(entry.key);
      const waitsUntil = previous?.signals.waitsUntil;
      const lapsed = waitsUntil !== undefined && now >= waitsUntil;
      if (previous && previous.key === key && !lapsed) return previous.signals;
      const read = readThreadSignals(room, entry.threadRootId, userId, now);
      // An agent asks whoever it talks with: in a thread the user takes no part in, not them.
      const { pendingQuestion: _theirs, ...others } = read;
      const signals = entry.isInvolved ? read : others;
      cache.set(entry.key, { key, signals });
      return signals;
    },
    prune: (keep) => {
      for (const key of cache.keys()) if (!keep.has(key)) cache.delete(key);
    },
  };
};

type ClientSignals = {
  reader: ThreadSignalsReader;
  /** Who listens to each room's changes, by room ID. */
  listeners: Map<string, Set<() => void>>;
};

const clients = new WeakMap<MatrixClient, ClientSignals>();

/**
 * The client's one signals cache and who listens to its rooms. What the client hears counts for
 * the thread it may show in (`changedThreadId`), so the other threads of the room keep their
 * signals: an event (also one a thread holds back, or one a page of history brings), its
 * decryption, an edit put on or taken off it, a local echo's progress, a redaction, the user's
 * receipt in a thread, and the thread's timeline starting over. It counts for every thread of the
 * room when the thread is unknown (an event related to one the room does not hold), for the
 * user's receipt outside a thread, a timeline of the room that starts over, and a member who
 * joins or leaves (an agent's presence decides whether a notice is listed). Signals read no one
 * else's receipts, no event without an ID (typing, a live reply frame, account data) and no
 * state event but the members', so those count for nothing and reach no listener. One exception: a room's first receipt after the client
 * starts, anyone's, counts for all its threads, since how old its oldest thread receipt was before
 * is not known.
 */
const getClientSignals = (mx: MatrixClient): ClientSignals => {
  let client = clients.get(mx);
  if (!client) {
    const changes = new Map<string, ThreadRecordChanges>();
    const listeners = new Map<string, Set<() => void>>();
    /** Counts for one thread of the room, or without `threadRootId` for all of them. */
    const mark = (roomId: string, threadRootId?: string) => {
      let roomChanges = changes.get(roomId);
      if (!roomChanges) {
        roomChanges = createThreadRecordChanges();
        changes.set(roomId, roomChanges);
      }
      markThreadRecordChange(roomChanges, threadRootId);
      listeners.get(roomId)?.forEach((listener) => listener());
    };
    const markEvent = (event: MatrixEvent) => {
      const room = mx.getRoom(event.getRoomId());
      const eventId = event.getId();
      // A state event starts no thread; what signals read of the room's state is its members.
      if (!room || !eventId || event.isState()) return;
      const changedId = changedThreadId(room, event);
      mark(room.roomId, changedId);
      // A message of the room that answers another one may be a root itself.
      if (changedId && !event.threadRootId && eventId !== changedId) mark(room.roomId, eventId);
    };
    mx.on(ClientEvent.Event, markEvent);
    mx.on(RoomEvent.Timeline, markEvent);
    mx.on(MatrixEventEvent.Decrypted, markEvent);
    mx.on(MatrixEventEvent.Replaced, markEvent);
    mx.on(RoomEvent.LocalEchoUpdated, markEvent);
    // By then the redacted event has left its thread, which the room names.
    mx.on(RoomEvent.Redaction, (event, room, threadRootId) => {
      if (threadRootId) mark(room.roomId, threadRootId);
      markEvent(event);
    });
    // A thread's timeline that starts over may have lost events of that thread, the room's of any.
    mx.on(RoomEvent.TimelineReset, (room, timelineSet) => {
      if (room) mark(room.roomId, timelineSet.thread?.id);
    });
    mx.on(RoomMemberEvent.Membership, (_event, member) => mark(member.roomId));
    // The user's first receipt in a thread, or one older than the others, changes how every
    // thread of the room is read (`getThreadEventReadUpTo`).
    const oldestThreadedReceiptTs = new Map<string, number>();
    mx.on(RoomEvent.Receipt, (receipt, room) => {
      const threadIds = receiptThreadIds(receipt, mx.getSafeUserId());
      const oldest = room.getOldestThreadedReceiptTs();
      if (!threadIds || oldest !== oldestThreadedReceiptTs.get(room.roomId)) mark(room.roomId);
      else threadIds.forEach((threadId) => mark(room.roomId, threadId));
      oldestThreadedReceiptTs.set(room.roomId, oldest);
    });
    const reader = createThreadSignalsReader((room, threadRootId) => {
      const roomChanges = changes.get(room.roomId);
      return roomChanges?.threads.get(threadRootId) ?? roomChanges?.room ?? 0;
    });
    client = { reader, listeners };
    clients.set(mx, client);
  }
  return client;
};

/** The client's one signals cache, shared by Activity and the Threads page. */
export const getThreadSignalsReader = (mx: MatrixClient): ThreadSignalsReader =>
  getClientSignals(mx).reader;

/**
 * Calls `onChange` each time the room hears what any of its threads' signals are read again for,
 * so a view that shows one thread's signals can follow them. Returns the unsubscribe.
 */
export const subscribeRoomSignals = (
  mx: MatrixClient,
  roomId: string,
  onChange: () => void
): (() => void) => {
  const { listeners } = getClientSignals(mx);
  const roomListeners = listeners.get(roomId) ?? new Set();
  roomListeners.add(onChange);
  listeners.set(roomId, roomListeners);
  return () => {
    roomListeners.delete(onChange);
    if (roomListeners.size === 0 && listeners.get(roomId) === roomListeners) {
      listeners.delete(roomId);
    }
  };
};
