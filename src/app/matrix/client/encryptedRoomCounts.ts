import {
  EventType,
  MatrixEvent,
  MatrixEventEvent,
  NotificationCountType,
  ReceiptType,
  RelationType,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import {
  STREAM_STATUS_KEY,
  TERMINAL_STREAM_STATUSES,
  hasTerminalStreamMetadata,
} from '../protocol/aiRun';
import { isRecord } from '../../lib/isRecord';

// The server cannot read an encrypted event, so in an encrypted room the SDK takes the server's
// unread count only when it is 0, and otherwise counts each event itself once it decrypts: an
// unread event the push rules notify for adds one (`fixNotificationCountOnDecryption`). For
// MindRoom two cases came out wrong (L5-F012):
// - An agent's reply that finishes is new again: the server counts its terminal edit (Tuwunel's
//   finished-stream rule). The SDK counts no edit, so a reply the reader left half-way and that
//   finished meanwhile left the room read.
// - Push rules see an event the SDK cannot decrypt without its relation, as a plain message. A
//   new session counted every streaming edit it had no key for: 23 for one reply.
// - MindRoom starts a reply with a message whose stream status ("pending", then "streaming") it
//   keeps in the clear, and Tuwunel counts no event that still streams. The SDK counted that first
//   message by its text, and again each time it decrypted it, so a reply that finished while the
//   reader was away showed 3 unread after a reload where the server counted 1 (and the thread's
//   title notice, which the client rightly leaves out).
// - A receipt on an event no timeline holds, such as the terminal edit of a reply the reader
//   watched to its end, means nothing to the SDK (P2-e2ee-F001). The server takes it as reading
//   everything up to it. When the reply, or any event of its thread, decrypted after the server's
//   last count (after a reload, on keys arriving late, on a new session without keys), the SDK and
//   this module counted it as unread, and no sync took it back.
// This module counts the finished reply and takes back the SDK's count of an edit or reaction it
// cannot decrypt, of a message that still streams and of an event the user's receipts read. Its
// listener runs after the SDK's own, which the client adds when it is made.

/** Relations that never count as unread messages of their own. */
const UNCOUNTED_RELATIONS: ReadonlySet<string> = new Set([
  RelationType.Replace,
  RelationType.Annotation,
]);

/** Edits counted already; another copy of one may decrypt again. */
const COUNTED_EDITS_LIMIT = 5000;

const relationOf = (event: MatrixEvent): Record<string, unknown> | undefined => {
  // Relations stay unencrypted, so the wire content has them before decryption too.
  const relation: unknown = event.getWireContent()['m.relates_to'];
  return isRecord(relation) ? relation : undefined;
};

/** The thread whose count an event changes, as the SDK picks it; undefined for the room's own. */
const countedThreadOf = (event: MatrixEvent): string | undefined =>
  event.threadRootId && !event.isThreadRoot ? event.threadRootId : undefined;

const changeCount = (
  room: Room,
  threadId: string | undefined,
  type: NotificationCountType,
  change: number
): void => {
  const count =
    (threadId
      ? room.getThreadUnreadNotificationCount(threadId, type)
      : room.getRoomUnreadNotificationCount(type)) ?? 0;
  const next = Math.max(0, count + change);
  if (threadId) room.setThreadUnreadNotificationCount(threadId, type, next);
  else room.setUnreadNotificationCount(type, next);
};

const changeCounts = (
  room: Room,
  threadId: string | undefined,
  actions: ReturnType<MatrixClient['getPushActionsForEvent']>,
  change: 1 | -1
): void => {
  if (actions?.tweaks?.highlight)
    changeCount(room, threadId, NotificationCountType.Highlight, change);
  if (actions?.notify) changeCount(room, threadId, NotificationCountType.Total, change);
};

/**
 * Whether the event still streams, by the status MindRoom keeps in the clear. Tuwunel counts no
 * such event, only the finished reply's terminal edit.
 */
const stillStreams = (event: MatrixEvent): boolean => {
  const status: unknown = event.getWireContent()[STREAM_STATUS_KEY];
  return typeof status === 'string' && !TERMINAL_STREAM_STATUSES.has(status.toLowerCase());
};

/**
 * Whether the user's receipts read `event`, as the server takes them: a receipt in its thread (or
 * the main timeline) on it or on a later event, or an unthreaded one sent after it. A receipt can
 * name an edit, which no timeline holds; it was sent when the edit was read. The SDK then prefers
 * the receipt it makes up for the user's own last message, which can be older: both count.
 */
const readByOwnReceipts = (
  room: Room,
  threadId: string | undefined,
  userId: string,
  event: MatrixEvent
): boolean => {
  const unthreadedTs = room.getLastUnthreadedReceiptFor(userId)?.ts;
  if (unthreadedTs !== undefined && unthreadedTs >= event.getTs()) return true;
  const context = threadId ? room.getThread(threadId) : room;
  const receipts = [ReceiptType.Read, ReceiptType.ReadPrivate].flatMap((receiptType) =>
    [true, false].map((realOnly) =>
      context?.getReadReceiptForUserId(userId, realOnly, receiptType)
    )
  );
  return receipts.some((receipt) => {
    if (!receipt) return false;
    if (receipt.eventId === event.getId()) return true;
    const readTs =
      (context?.findEventById(receipt.eventId) ?? room.findEventById(receipt.eventId))?.getTs() ??
      receipt.data.ts;
    return readTs >= event.getTs();
  });
};

/** Whether the server counts no such event: an edit, a reaction or a message that still streams. */
const uncountedByServer = (event: MatrixEvent): boolean => {
  const relationType = relationOf(event)?.rel_type;
  return (
    (typeof relationType === 'string' && UNCOUNTED_RELATIONS.has(relationType)) ||
    stillStreams(event)
  );
};

/**
 * Takes back what the SDK counted for a decrypted event, under the same conditions it counts (the
 * event is in the room, unread to the SDK, and its push actions notify), when the server counts no
 * such event or the user's receipts read it.
 */
const takeBackSdkCount = (mx: MatrixClient, room: Room, event: MatrixEvent): void => {
  const userId = mx.getUserId();
  const eventId = event.getId();
  if (!userId || !eventId || !room.findEventById(eventId)) return;
  const threadId = countedThreadOf(event);
  if (threadId) {
    const thread = room.getThread(threadId);
    if (!thread || thread.hasUserReadEvent(userId, eventId)) return;
  } else if (room.hasUserReadEvent(userId, eventId)) return;
  if (!uncountedByServer(event) && !readByOwnReceipts(room, threadId, userId, event)) return;
  changeCounts(room, threadId, mx.getPushActionsForEvent(event), -1);
};

/**
 * Counts the terminal edit of an agent's streamed reply as a new message, as the server does:
 * when the user has not read it, by the push rules for the reply's final content.
 */
const countFinishedReply = (
  mx: MatrixClient,
  room: Room,
  edit: MatrixEvent,
  counted: Set<string>
): void => {
  const relation = relationOf(edit);
  if (relation?.rel_type !== RelationType.Replace || typeof relation.event_id !== 'string') return;
  const userId = mx.getUserId();
  const editId = edit.getId();
  if (!userId || !editId || edit.getSender() === userId || counted.has(editId)) return;
  const finished: unknown = edit.getContent()['m.new_content'];
  if (!isRecord(finished) || !hasTerminalStreamMetadata(finished)) return;
  const reply = room.findEventById(relation.event_id);
  if (!reply || reply.getSender() !== edit.getSender()) return;
  const threadId = countedThreadOf(reply);
  // As the SDK does: without the thread there are no receipts to tell, so nothing counts.
  if (threadId && !room.getThread(threadId)) return;
  if (readByOwnReceipts(room, threadId, userId, edit)) return;

  if (counted.size >= COUNTED_EDITS_LIMIT) counted.clear();
  counted.add(editId);
  const unrelated = { ...finished };
  delete unrelated['m.relates_to'];
  const finishedReply = new MatrixEvent({
    type: EventType.RoomMessage,
    room_id: room.roomId,
    sender: reply.getSender(),
    event_id: editId,
    origin_server_ts: edit.getTs(),
    content: unrelated,
  });
  changeCounts(room, threadId, mx.getPushActionsForEvent(finishedReply), 1);
};

/**
 * Keeps the unread counts of the client's encrypted rooms in line with the server's rules for the
 * events the client can read; call it before the client starts. Returns a function that stops it.
 */
export const keepEncryptedRoomCounts = (mx: MatrixClient): (() => void) => {
  const counted = new Set<string>();
  const onDecrypted = (event: MatrixEvent) => {
    const roomId = event.getRoomId();
    const room = roomId ? mx.getRoom(roomId) : null;
    if (!room?.hasEncryptionStateEvent()) return;
    takeBackSdkCount(mx, room, event);
    if (!event.isDecryptionFailure() && !stillStreams(event)) {
      countFinishedReply(mx, room, event, counted);
    }
  };
  mx.on(MatrixEventEvent.Decrypted, onDecrypted);
  return () => {
    mx.removeListener(MatrixEventEvent.Decrypted, onDecrypted);
  };
};
