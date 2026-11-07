import { ReceiptType, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { isSeenThreadRoot } from './seenThreadRoots';
import { isConversationNotice } from './protocol/conversationNotice';
import { hasActiveMindroomAgent } from './protocol/agentIdentity';

/**
 * When the user last read the room's main timeline: the newest of their main and unthreaded
 * receipts, public or private, was sent then. The server reads the main timeline up to that
 * moment, whichever event the receipt names: an unthreaded receipt often names a thread reply,
 * which the main timeline does not hold.
 */
export const getMainTimelineReadTs = (room: Room, userId: string): number => {
  // Optional calls: room stand-ins in tests often have no receipts or threads.
  let readTs = room.getLastUnthreadedReceiptFor?.(userId)?.ts ?? Number.NEGATIVE_INFINITY;
  [ReceiptType.Read, ReceiptType.ReadPrivate].forEach((type) => {
    [false, true].forEach((ignoreSynthesized) => {
      const ts = room.getReadReceiptForUserId?.(userId, ignoreSynthesized, type)?.data.ts;
      if (ts !== undefined && ts > readTs) readTs = ts;
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
 * Whether the thread lists that a room with a MindRoom agent shows leave out a notice: one
 * without replies that no agent marked as a conversation (`isConversationNotice`), such as an
 * agent's status line. A room without an agent shows its whole conversation, notices included.
 */
const isUnlistedNotice = (room: Room, event: MatrixEvent): boolean =>
  event.getContent().msgtype === 'm.notice' &&
  !event.isThreadRoot &&
  !isConversationNotice(event) &&
  hasActiveMindroomAgent(room.getMembers());

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
