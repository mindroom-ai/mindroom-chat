import type { MatrixEvent } from 'matrix-js-sdk';
import { ReceiptType } from 'matrix-js-sdk/lib/@types/read_receipts';
import { ReadReceipt } from 'matrix-js-sdk/lib/models/read-receipt';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import { unthreadedReceiptReadTs } from '../../matrix/receiptReadTs';

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
 * `Thread.getEventReadUpTo` without two of the SDK's rules. For the signed-in user, the first reads
 * a thread up to its last event whenever the event is older than their oldest thread receipt in
 * the room, so with no thread receipt there yet every thread counts as read, and the first one
 * read makes every thread with older activity read too. The second reads the thread up to when the
 * server took the user's newer unthreaded receipt; the server reads it only up to the event it
 * names (`unthreadedReceiptReadTs`). The server keeps counting the replies both rules read. Where
 * either would decide, this answers the thread's own receipt, from `ReadReceipt`, unless the walk
 * back from the newest event first reaches one the unthreaded receipt reads. When the receipt
 * names no loaded event, a receipt on an edit of a loaded reply reads that reply
 * (`replyEditedByReceipt`).
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
  const unthreadedTs = unthreadedReceiptReadTs(thread.room, userId, thread);
  if (!readByLegacyRule && unthreadedTs === undefined) return thread.getEventReadUpTo(userId);

  const receiptEventId = ReadReceipt.prototype.getEventReadUpTo.call(thread, userId);
  if (unthreadedTs === undefined) return receiptEventId;
  const reached = thread.events.findLast(
    (event) => event.getId() === receiptEventId || event.getTs() <= unthreadedTs
  );
  return reached?.getId() ?? receiptEventId;
};
