import {
  RoomEvent,
  ThreadEvent,
  type EventTimelineSet,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { MAIN_ROOM_TIMELINE, ReceiptType } from 'matrix-js-sdk/lib/@types/read_receipts';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import { isRecord } from '../lib/isRecord';

// How far a receipt reads, by the server's rule since mindroom-tuwunel #140 (v1.9.4-mindroom.31):
// up to the event it names, so an older receipt leaves the events after its event unread. Before,
// a receipt read everything its context held when the server took it.

// The event each of the user's unthreaded receipts names, by the receipt the SDK keeps; the SDK
// keeps only when the server took an unthreaded receipt.
const unthreadedReceiptEvents = new WeakMap<object, string>();

// The user's newest receipt of each type in each context of a room: unthreaded (''), the main
// timeline (`main`) or a thread (its root). The server keeps one receipt per context and type and
// only moves it forward, so the newest one taken in a context reads furthest there. The SDK keeps
// one receipt per type for unthreaded and `main` receipts together, and one unthreaded receipt of
// either type, the newest taken: a stale device's older receipt, taken later, replaced a newer one.
type SeenReceipt = { eventId: string; ts: number };
const seenReceipts = new WeakMap<Room, Map<string, SeenReceipt>>();
const seenReceiptKey = (userId: string, type: string, threadId: string) =>
  `${userId}\n${type}\n${threadId}`;

const rememberReceipts = (receiptEvent: MatrixEvent, room: Room, userId: string | null): void => {
  if (!userId) return;
  Object.entries(receiptEvent.getContent()).forEach(([eventId, byType]) => {
    if (!isRecord(byType)) return;
    Object.entries(byType).forEach(([type, byUser]) => {
      const receipt = isRecord(byUser) ? byUser[userId] : undefined;
      if (!isRecord(receipt)) return;
      if (receipt.thread_id === undefined) unthreadedReceiptEvents.set(receipt, eventId);
      const threadId = typeof receipt.thread_id === 'string' ? receipt.thread_id : '';
      const ts = typeof receipt.ts === 'number' ? receipt.ts : 0;
      let seen = seenReceipts.get(room);
      if (!seen) {
        seen = new Map();
        seenReceipts.set(room, seen);
      }
      const key = seenReceiptKey(userId, type, threadId);
      if ((seen.get(key)?.ts ?? -Infinity) <= ts) seen.set(key, { eventId, ts });
    });
  });
};

/**
 * Remembers the user's receipts in each context and the event each names, for
 * `unthreadedReceiptReadTs` and `contextReceiptReadTs`. The listener goes first, so the views that
 * update on a receipt find its event.
 */
export const keepUnthreadedReceiptEvents = (mx: MatrixClient): (() => void) => {
  const onReceipt = (event: MatrixEvent, room: Room) =>
    rememberReceipts(event, room, mx.getUserId());
  mx.prependListener(RoomEvent.Receipt, onReceipt);
  return () => {
    mx.removeListener(RoomEvent.Receipt, onReceipt);
  };
};

// What a room was asked for the events its receipts name. Asking the room for an event it does
// not hold costs a lookup in each of its threads, and the callers ask for every thread and receipt
// type, so an answer of "not held" is kept until the room gains an event of that ID: one a
// timeline takes, one a local echo is renamed to, or one a new thread holds.
type NamedEvents = {
  /** Every ID asked for. */
  asked: Set<string>;
  /** Those no timeline of the room held. */
  unheld: Set<string>;
  /** See `receiptEventsVersion`. */
  version: number;
};
const namedEvents = new WeakMap<Room, NamedEvents>();

/**
 * A count of the changes in the events `room` holds that may move how far a receipt reads: an
 * unheld event it came to hold, a local echo of a named event that moved on (the server's time
 * replaces the device's), and events it lost (a timeline that starts over or drops an event, a
 * thread that goes). For caches of how far receipts read.
 */
export const receiptEventsVersion = (room: Room): number => namedEvents.get(room)?.version ?? 0;

/** Whether the room looks events up in `timelineSet`: not in its lists of threads. */
const holdsEvents = (room: Room, timelineSet: EventTimelineSet): boolean =>
  !(room.threadsTimelineSets as readonly EventTimelineSet[]).includes(timelineSet);

const namedEventsOf = (room: Room): NamedEvents | undefined => {
  let named = namedEvents.get(room);
  // Optional: room stand-ins in tests often tell nothing of their events, so nothing is kept.
  if (!named && typeof room.prependListener === 'function') {
    const kept: NamedEvents = { asked: new Set(), unheld: new Set(), version: 0 };
    // First, so the views that update on an event find it.
    room.prependListener(RoomEvent.Timeline, (event, _room, _toStart, removed, data) => {
      // A reply moves its thread's root in the lists of threads, which hold no event for lookups.
      const lost = removed && holdsEvents(room, data.timeline.getTimelineSet());
      if (lost || kept.unheld.delete(event.getId() ?? '')) kept.version += 1;
    });
    room.prependListener(RoomEvent.LocalEchoUpdated, (event) => {
      const eventId = event.getId() ?? '';
      kept.unheld.delete(eventId);
      if (kept.asked.has(eventId)) kept.version += 1;
    });
    room.prependListener(ThreadEvent.New, (thread: Thread) => {
      kept.unheld.forEach((id) => {
        if (thread.findEventById(id) && kept.unheld.delete(id)) kept.version += 1;
      });
    });
    room.prependListener(RoomEvent.TimelineReset, (_room, timelineSet) => {
      if (holdsEvents(room, timelineSet)) kept.version += 1;
    });
    room.prependListener(ThreadEvent.Delete, () => {
      kept.version += 1;
    });
    namedEvents.set(room, kept);
    named = kept;
  }
  return named;
};

const findNamedEvent = (
  room: Room,
  context: Room | Thread,
  eventId: string
): MatrixEvent | undefined => {
  // Before any answer, so the room tells of what happens to a named event from the first lookup.
  const kept = namedEventsOf(room);
  kept?.asked.add(eventId);
  // Optional calls here and below: room and thread stand-ins in tests often lack receipts, events
  // or, for a thread, its room.
  const inContext = context === room ? undefined : context.findEventById?.(eventId);
  if (inContext) return inContext;
  if (kept?.unheld.has(eventId)) return undefined;
  const named = room.findEventById?.(eventId);
  if (!named) kept?.unheld.add(eventId);
  return named;
};

/**
 * How far a receipt in `context` (the room's main timeline, or a thread) reads: up to the event it
 * names. A receipt on an event the client does not hold (often a reply's terminal edit, which no
 * timeline keeps) reads up to when the server took it, `takenTs`.
 */
export const receiptReadTs = (
  room: Room,
  context: Room | Thread,
  eventId: string | undefined,
  takenTs: number
): number => (eventId ? findNamedEvent(room, context, eventId)?.getTs() : undefined) ?? takenTs;

const maxOf = (...values: Array<number | undefined>): number | undefined => {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length > 0 ? Math.max(...known) : undefined;
};

/** How far the user's remembered receipts in `threadId` (public or private) read `context`. */
const seenReceiptReadTs = (
  room: Room,
  userId: string,
  context: Room | Thread,
  threadId: string
): number | undefined => {
  const seen = room ? seenReceipts.get(room) : undefined;
  return maxOf(
    ...[ReceiptType.Read, ReceiptType.ReadPrivate].map((type) => {
      const receipt = seen?.get(seenReceiptKey(userId, type, threadId));
      return receipt && receiptReadTs(room, context, receipt.eventId, receipt.ts);
    })
  );
};

/**
 * How far the user's unthreaded receipts, public or private, read `context` (`receiptReadTs`);
 * they read every context of the room. Undefined when the user has none.
 */
export const unthreadedReceiptReadTs = (
  room: Room,
  userId: string,
  context: Room | Thread = room
): number | undefined => {
  const receipt = room?.getLastUnthreadedReceiptFor?.(userId);
  return maxOf(
    receipt && receiptReadTs(room, context, unthreadedReceiptEvents.get(receipt), receipt.ts),
    seenReceiptReadTs(room, userId, context, '')
  );
};

/**
 * How far the user's receipts read `context` (the room's main timeline, or a thread): the newest of
 * their unthreaded receipts and their receipts in the context itself, public or private, each up to
 * the event it names. An older receipt never moves a newer one back, as on the server, where
 * counts only decrease. Undefined when the user has none of them.
 */
export const contextReceiptReadTs = (
  room: Room,
  userId: string,
  context: Room | Thread = room
): number | undefined =>
  maxOf(
    unthreadedReceiptReadTs(room, userId, context),
    seenReceiptReadTs(
      room,
      userId,
      context,
      context === room ? MAIN_ROOM_TIMELINE : (context as Thread).id
    )
  );
