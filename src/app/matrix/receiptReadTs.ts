import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
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
): number => {
  // Optional calls here and below: room and thread stand-ins in tests often lack receipts, events
  // or, for a thread, its room.
  const named = eventId
    ? context.findEventById?.(eventId) ?? room.findEventById?.(eventId)
    : undefined;
  return named?.getTs() ?? takenTs;
};

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
