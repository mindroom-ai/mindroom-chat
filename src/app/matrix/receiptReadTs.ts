import { RoomEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import { isRecord } from '../lib/isRecord';

// How far a receipt reads, by the server's rule since mindroom-tuwunel #140 (v1.9.4-mindroom.31):
// up to the event it names, so an older receipt leaves the events after its event unread. Before,
// a receipt read everything its context held when the server took it.

// The event each of the user's unthreaded receipts names, by the receipt the SDK keeps; the SDK
// keeps only when the server took an unthreaded receipt.
const unthreadedReceiptEvents = new WeakMap<object, string>();

const rememberUnthreadedReceipts = (receiptEvent: MatrixEvent, userId: string | null): void => {
  Object.entries(receiptEvent.getContent()).forEach(([eventId, byType]) => {
    if (!isRecord(byType)) return;
    Object.values(byType).forEach((byUser) => {
      const receipt = isRecord(byUser) && userId ? byUser[userId] : undefined;
      if (isRecord(receipt) && receipt.thread_id === undefined) {
        unthreadedReceiptEvents.set(receipt, eventId);
      }
    });
  });
};

/**
 * Remembers the event each of the user's unthreaded receipts names, for `unthreadedReceiptReadTs`.
 * The listener goes first, so the views that update on a receipt find its event.
 */
export const keepUnthreadedReceiptEvents = (mx: MatrixClient): (() => void) => {
  const onReceipt = (event: MatrixEvent) => rememberUnthreadedReceipts(event, mx.getUserId());
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

/**
 * How far the user's unthreaded receipt reads in `context` (`receiptReadTs`); it reads every
 * context of the room. Undefined when the user has none.
 */
export const unthreadedReceiptReadTs = (
  room: Room,
  userId: string,
  context: Room | Thread = room
): number | undefined => {
  const receipt = room?.getLastUnthreadedReceiptFor?.(userId);
  return receipt
    ? receiptReadTs(room, context, unthreadedReceiptEvents.get(receipt), receipt.ts)
    : undefined;
};
