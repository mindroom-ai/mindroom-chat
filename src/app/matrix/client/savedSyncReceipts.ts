import { ReceiptType } from 'matrix-js-sdk';
import { ReceiptAccumulator } from 'matrix-js-sdk/lib/receipt-accumulator';
import type { IMinimalEvent } from 'matrix-js-sdk/lib/sync-accumulator';
import { isRecord } from '../../lib/isRecord';

// The SDK's sync store keeps each user's newest receipts per room and saves them as one
// `m.receipt` event, which a reload replays. It kept one unthreaded receipt per user and one per
// user and thread, whatever their type, so a private receipt the server sent again (it repeats all
// of them when one changes) replaced a newer public one. And the event holds one receipt per
// user, type and event, so a thread receipt on the event that an unthreaded receipt also names
// replaced the unthreaded one. After a reload the threads that receipt read came back unread,
// while the server counted them read.
//
// This keeps a user's receipts apart by type and by thread, as the server does, and gives the
// unthreaded receipt the place when two name the same event: it reads all a thread receipt on
// that event reads, and more.

type SavedReceipt = {
  eventId: string;
  type: string;
  userId: string;
  data: Record<string, unknown>;
};

const RECEIPT_TYPES = new Set<string>([ReceiptType.Read, ReceiptType.ReadPrivate]);

const savedReceipts = new WeakMap<ReceiptAccumulator, Map<string, SavedReceipt>>();

const receiptsOf = (accumulator: ReceiptAccumulator): Map<string, SavedReceipt> => {
  let receipts = savedReceipts.get(accumulator);
  if (!receipts) {
    receipts = new Map();
    savedReceipts.set(accumulator, receipts);
  }
  return receipts;
};

const threadOf = (receipt: SavedReceipt): string | undefined =>
  typeof receipt.data.thread_id === 'string' ? receipt.data.thread_id : undefined;

function consumeEphemeralEvents(this: ReceiptAccumulator, events: IMinimalEvent[] | undefined) {
  const receipts = receiptsOf(this);
  events?.forEach((event) => {
    if (event.type !== 'm.receipt' || !isRecord(event.content)) return;
    Object.entries(event.content).forEach(([eventId, byType]) => {
      if (!isRecord(byType)) return;
      Object.entries(byType).forEach(([type, byUser]) => {
        if (!RECEIPT_TYPES.has(type) || !isRecord(byUser)) return;
        Object.entries(byUser).forEach(([userId, data]) => {
          if (!isRecord(data)) return;
          const receipt = { eventId, type, userId, data };
          // The server sends a user's receipts of one type and thread in order: the last wins.
          receipts.set(JSON.stringify([threadOf(receipt) ?? '', type, userId]), receipt);
        });
      });
    });
  });
}

function buildAccumulatedReceiptEvent(
  this: ReceiptAccumulator,
  roomId: string
): IMinimalEvent | null {
  const receipts = [...receiptsOf(this).values()];
  if (receipts.length === 0) return null;
  const content: Record<string, Record<string, Record<string, unknown>>> = {};
  // Unthreaded receipts last, so they keep the place a thread receipt on their event wanted.
  const ordered = [
    ...receipts.filter((receipt) => threadOf(receipt) !== undefined),
    ...receipts.filter((receipt) => threadOf(receipt) === undefined),
  ];
  ordered.forEach(({ eventId, type, userId, data }) => {
    const byType = (content[eventId] ??= {});
    (byType[type] ??= {})[userId] = data;
  });
  return { type: 'm.receipt', room_id: roomId, content };
}

/**
 * Makes the SDK's sync store save every receipt a reload needs (see above). Call it before a sync
 * store starts, since starting replays the saved receipts; it changes the SDK's receipt store
 * once, for every client.
 */
export const keepEveryReceiptInSavedSync = (): void => {
  const accumulator = ReceiptAccumulator.prototype;
  if (accumulator.consumeEphemeralEvents === consumeEphemeralEvents) return;
  accumulator.consumeEphemeralEvents = consumeEphemeralEvents;
  accumulator.buildAccumulatedReceiptEvent = buildAccumulatedReceiptEvent;
};
