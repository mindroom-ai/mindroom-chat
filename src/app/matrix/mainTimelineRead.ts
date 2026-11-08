import { ReceiptType, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { isSeenThreadRoot } from './seenThreadRoots';
import { isUnmarkedNotice } from './protocol/conversationNotice';
import { hasActiveMindroomAgent } from './protocol/agentIdentity';
import { contextReceiptReadTs, receiptReadTs } from './receiptReadTs';

/**
 * When the user last read the room's main timeline: the newest of the events their main and
 * unthreaded receipts, public or private, name (`contextReceiptReadTs`), and the receipts the SDK
 * keeps for it, its own local echoes included. The server reads the main timeline up to that
 * event, wherever it is: an unthreaded receipt often names a thread reply, which the main timeline
 * does not hold.
 */
export const getMainTimelineReadTs = (room: Room, userId: string): number => {
  let readTs = contextReceiptReadTs(room, userId) ?? Number.NEGATIVE_INFINITY;
  [ReceiptType.Read, ReceiptType.ReadPrivate].forEach((type) => {
    [false, true].forEach((ignoreSynthesized) => {
      // Optional call: room stand-ins in tests often have no receipts.
      const receipt = room.getReadReceiptForUserId?.(userId, ignoreSynthesized, type);
      if (receipt) {
        readTs = Math.max(readTs, receiptReadTs(room, room, receipt.eventId, receipt.data.ts));
      }
    });
  });
  return readTs;
};

/** Whether the user replied in the thread under this event, so they have seen it. */
const answeredInThread = (room: Room, event: MatrixEvent, userId: string): boolean => {
  const eventId = event.getId();
  const thread = eventId ? room.getThread?.(eventId) : undefined;
  if (!thread) return false;
  return (
    !!thread.hasCurrentUserParticipated ||
    thread.replyToEvent?.getSender() === userId ||
    (thread.events ?? []).some((reply) => reply !== event && reply.getSender() === userId)
  );
};

/**
 * Whether the thread lists that a room with a MindRoom agent shows leave out a notice: an unmarked
 * one (`isUnmarkedNotice`) without replies. A room without an agent shows its whole conversation,
 * notices included.
 */
const isUnlistedNotice = (room: Room, event: MatrixEvent): boolean =>
  isUnmarkedNotice(event) && !event.isThreadRoot && hasActiveMindroomAgent(room.getMembers());

/**
 * Whether a message in the main timeline, such as a thread root, is unread for the user: someone
 * else sent it after the user last read the main timeline (`readTs`, see
 * `getMainTimelineReadTs`), the thread lists show it (not `isUnlistedNotice`), the user has not
 * replied in its thread, and has not opened its thread on this device (`isSeenThreadRoot`). The
 * room's unread dot and the unread thread filter both follow this rule, so a room is unread only
 * for what the filter finds.
 */
export const isMainTimelineMessageUnread = (
  room: Room,
  event: MatrixEvent,
  userId: string,
  readTs = getMainTimelineReadTs(room, userId)
): boolean =>
  event.getSender() !== userId &&
  !event.isRedacted() &&
  event.getTs() > readTs &&
  !isUnlistedNotice(room, event) &&
  !answeredInThread(room, event, userId) &&
  !isSeenThreadRoot(userId, room.roomId, event.getId());
