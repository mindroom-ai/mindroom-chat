import type { MatrixEvent } from 'matrix-js-sdk';
import { ReceiptType } from 'matrix-js-sdk/lib/@types/read_receipts';
import { ReadReceipt } from 'matrix-js-sdk/lib/models/read-receipt';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';

/**
 * The loaded reply that the reader's thread receipt reads through an edit of it. A streamed reply
 * ends with an edit, and the receipt for the finished reply names that edit, which the thread may
 * not hold (after a reload, or on another device, where the server bundles the edit with the
 * reply): the SDK then ignores the receipt, and the thread would look unread.
 */
const replyEditedByReceipt = (thread: Thread, userId: string): string | null => {
  const receiptIds = [ReceiptType.Read, ReceiptType.ReadPrivate].flatMap((type) => {
    const receipt = thread.getReadReceiptForUserId?.(userId, false, type);
    return receipt?.data?.thread_id === thread.id ? [receipt.eventId] : [];
  });
  if (receiptIds.length === 0) return null;
  const editedBy = (event: MatrixEvent) =>
    receiptIds.includes(event.replacingEventId() ?? '') ||
    receiptIds.includes(event.replacingEvent()?.getId() ?? '');
  const replies = [...(thread.events ?? []), thread.replyToEvent].filter(
    (event): event is MatrixEvent => !!event
  );
  return replies.findLast(editedBy)?.getId() ?? null;
};

/**
 * `Thread.getEventReadUpTo` without the SDK's rule for accounts from before thread receipts. For
 * the signed-in user, that rule reads a thread up to its last event whenever the event is older
 * than their oldest thread receipt in the room, so with no thread receipt there yet every thread
 * counts as read, and the first one read makes every thread with older activity read too. The
 * server keeps counting those replies. Where the rule would decide, this answers what the SDK
 * (41.7) answers past it: the thread's own receipt, from `ReadReceipt`, unless the walk back from
 * the newest event first reaches one older than a newer unthreaded receipt. When the receipt names
 * no loaded event, a receipt on an edit of a loaded reply reads that reply (`replyEditedByReceipt`).
 */
export const getThreadEventReadUpTo = (thread: Thread, userId: string): string | null =>
  getReceiptEventReadUpTo(thread, userId) ?? replyEditedByReceipt(thread, userId);

const getReceiptEventReadUpTo = (thread: Thread, userId: string): string | null => {
  const lastEvent = thread.events?.at(-1);
  const oldestThreadReceiptTs = thread.room?.getOldestThreadedReceiptTs?.();
  const readByLegacyRule =
    lastEvent !== undefined &&
    !!lastEvent.getId() &&
    oldestThreadReceiptTs !== undefined &&
    lastEvent.getTs() < oldestThreadReceiptTs &&
    userId === thread.client?.getUserId?.();
  if (!readByLegacyRule) return thread.getEventReadUpTo(userId);

  const receiptEventId = ReadReceipt.prototype.getEventReadUpTo.call(thread, userId);
  const unthreadedTs = thread.room.getLastUnthreadedReceiptFor(userId)?.ts;
  if (unthreadedTs === undefined) return receiptEventId;
  const reached = thread.events.findLast(
    (event) => event.getId() === receiptEventId || event.getTs() < unthreadedTs
  );
  return reached?.getId() ?? receiptEventId;
};
