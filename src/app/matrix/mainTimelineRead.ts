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
 * `getMainTimelineReadTs`), the thread lists show it (not `isUnlistedNotice`), and the user has
 * not opened its thread on this device (`isSeenThreadRoot`). A reply of the user's in its thread
 * reads only that thread, as on the server (mindroom-tuwunel #139), which keeps counting the root.
 * The room's unread dot and the unread thread filter both follow this rule, so a room is unread
 * only for what the filter finds.
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
  !isSeenThreadRoot(userId, room.roomId, event.getId());
