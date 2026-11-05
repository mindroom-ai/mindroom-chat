import { ReadReceipt } from 'matrix-js-sdk/lib/models/read-receipt';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';

/**
 * `Thread.getEventReadUpTo` without the SDK's rule for accounts from before thread receipts. For
 * the signed-in user, that rule reads a thread up to its last event whenever the event is older
 * than their oldest thread receipt in the room, so with no thread receipt there yet every thread
 * counts as read, and the first one read makes every thread with older activity read too. The
 * server keeps counting those replies. Where the rule would decide, this answers what the SDK
 * (41.7) answers past it: the thread's own receipt, from `ReadReceipt`, unless the walk back from
 * the newest event first reaches one older than a newer unthreaded receipt.
 */
export const getThreadEventReadUpTo = (thread: Thread, userId: string): string | null => {
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
