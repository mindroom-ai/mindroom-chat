import {
  ClientEvent,
  EventType,
  MatrixEvent,
  MatrixEventEvent,
  NotificationCountType,
  ReceiptType,
  RelationType,
  RoomEvent,
  type MatrixClient,
  type Room,
} from 'matrix-js-sdk';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import {
  getStreamStatusFromContent,
  hasTerminalStreamMetadata,
  TERMINAL_STREAM_STATUSES,
} from '../protocol/aiRun';
import { isRecord } from '../../lib/isRecord';

// The server cannot read an encrypted event, so in an encrypted room the SDK takes the server's
// unread count only when it is 0 and otherwise counts each event itself as it decrypts. Counting
// by decryption went wrong for MindRoom in several ways (L5-F012, P2-e2ee-F001, P2-lane2-F005):
// it never counted an agent's finished reply (the server counts its terminal edit), counted
// streaming edits and replies that still stream (the server counts neither), took no receipt on
// an edit as reading it, skipped events that decrypted before their thread existed, and kept what
// it had counted once: two devices of one account showed different counts, and a room read on
// another device came back unread after a reload.
//
// So the client counts an encrypted room again from what it holds whenever that changes, by the
// server's rules (mindroom-tuwunel): a context (the main timeline or a thread) counts the events
// after the user last read it that the push rules notify for. Reading is a receipt in the context
// at the time the server took it, an unthreaded receipt (it reads every context), or a message of
// the user's own (the server takes it as an unthreaded receipt). A reply that streams counts as
// one message once its terminal edit arrives, at that edit's time; the reply's first event, its
// other edits and reactions count as nothing. The thread's title notice counts on the server,
// whose push rules cannot read it, but not here, where they can (design decision #17).

/** Relations that never count as unread messages of their own. */
const UNCOUNTED_RELATIONS: ReadonlySet<string> = new Set([
  RelationType.Replace,
  RelationType.Annotation,
]);

/** Terminal edits remembered per reply; the oldest are forgotten first. */
const FINISHING_EDITS_LIMIT = 5000;

type Counts = { total: number; highlight: number };

const relationOf = (event: MatrixEvent): Record<string, unknown> | undefined => {
  // Relations stay unencrypted, so the wire content has them before decryption too.
  const relation: unknown = event.getWireContent()['m.relates_to'];
  return isRecord(relation) ? relation : undefined;
};

/** The stream status MindRoom keeps in the clear, else the one in the decrypted content. */
const streamStatusOf = (event: MatrixEvent): string | undefined =>
  getStreamStatusFromContent(event.getWireContent()) ??
  (event.isDecryptionFailure() ? undefined : getStreamStatusFromContent(event.getContent()));

/** A reply's first event while MindRoom streams it; the server counts only its terminal edit. */
const isStreamedReply = (event: MatrixEvent): boolean => {
  const wire = getStreamStatusFromContent(event.getWireContent());
  const status =
    wire ??
    (event.isDecryptionFailure()
      ? undefined
      : getStreamStatusFromContent(event.getOriginalContent()));
  return !!status && !TERMINAL_STREAM_STATUSES.has(status);
};

const isFinishingEdit = (edit: MatrixEvent): boolean => {
  const status = streamStatusOf(edit);
  if (status) return TERMINAL_STREAM_STATUSES.has(status);
  return !edit.isDecryptionFailure() && hasTerminalStreamMetadata(edit.getContent());
};

/** Whether the server counts `event` as a message of its own. */
const isCountedEvent = (event: MatrixEvent, userId: string): boolean => {
  if (event.getSender() === userId || event.isRedacted() || event.isState()) return false;
  const relationType = relationOf(event)?.rel_type;
  return !(typeof relationType === 'string' && UNCOUNTED_RELATIONS.has(relationType));
};

const add = (counts: Counts, actions: ReturnType<MatrixClient['getPushActionsForEvent']>) => {
  if (actions?.notify) counts.total += 1;
  if (actions?.tweaks?.highlight) counts.highlight += 1;
};

/** How the push rules take a finished reply: by its final content, once that is readable. */
const finishedReplyActions = (
  mx: MatrixClient,
  room: Room,
  reply: MatrixEvent,
  edit: MatrixEvent
) => {
  const finished: unknown = edit.isDecryptionFailure()
    ? undefined
    : edit.getContent()['m.new_content'];
  if (!isRecord(finished)) return mx.getPushActionsForEvent(edit);
  const content = { ...finished };
  delete content['m.relates_to'];
  return mx.getPushActionsForEvent(
    new MatrixEvent({
      type: EventType.RoomMessage,
      room_id: room.roomId,
      sender: reply.getSender(),
      event_id: edit.getId(),
      origin_server_ts: edit.getTs(),
      content,
    })
  );
};

/**
 * When the user last read `context` (the room's main timeline, or a thread), as the server takes
 * it: the newest of its receipts there (as the server dated it, or the event it names, whichever
 * is later), its unthreaded receipt, and its own last message in the room.
 */
const readUpTo = (
  room: Room,
  context: Room | Thread,
  userId: string,
  ownLastTs: number
): number => {
  let readTs = Math.max(ownLastTs, room.getLastUnthreadedReceiptFor(userId)?.ts ?? -Infinity);
  [ReceiptType.Read, ReceiptType.ReadPrivate].forEach((receiptType) => {
    [true, false].forEach((realOnly) => {
      const receipt = context.getReadReceiptForUserId(userId, realOnly, receiptType);
      if (!receipt) return;
      const named = context.findEventById(receipt.eventId) ?? room.findEventById(receipt.eventId);
      readTs = Math.max(readTs, receipt.data?.ts ?? -Infinity, named?.getTs() ?? -Infinity);
    });
  });
  return readTs;
};

/** The unread events of one context, newest first, by the rules above. */
const countContext = (
  mx: MatrixClient,
  room: Room,
  events: readonly MatrixEvent[],
  threadId: string | undefined,
  readTs: number,
  userId: string,
  finishingEdit: (reply: MatrixEvent) => MatrixEvent | undefined
): Counts => {
  const counts: Counts = { total: 0, highlight: 0 };
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.getId() === threadId) continue;
    const streamed = isStreamedReply(event);
    if (streamed && event.getSender() !== userId) {
      const edit = finishingEdit(event);
      if (edit && edit.getTs() > readTs) add(counts, finishedReplyActions(mx, room, event, edit));
    }
    // A reply read while it streamed can finish later; anything else read ends the count.
    if (event.getTs() <= readTs) {
      if (streamed) continue;
      break;
    }
    if (!streamed && isCountedEvent(event, userId)) add(counts, mx.getPushActionsForEvent(event));
  }
  return counts;
};

const setCounts = (room: Room, threadId: string | undefined, counts: Counts): void => {
  const changed = (type: NotificationCountType, value: number) =>
    (threadId
      ? room.getThreadUnreadNotificationCount(threadId, type)
      : room.getRoomUnreadNotificationCount(type)) !== value;
  [
    [NotificationCountType.Total, counts.total],
    [NotificationCountType.Highlight, counts.highlight],
  ].forEach(([type, value]) => {
    if (!changed(type as NotificationCountType, value as number)) return;
    if (threadId)
      room.setThreadUnreadNotificationCount(
        threadId,
        type as NotificationCountType,
        value as number
      );
    else room.setUnreadNotificationCount(type as NotificationCountType, value as number);
  });
};

/** The newest message of the user's own in the room, in any context. */
const ownLastTsOf = (room: Room, threads: Thread[], userId: string): number => {
  let ownLastTs = -Infinity;
  const scan = (events: readonly MatrixEvent[]) => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event && event.getSender() === userId && !event.isState()) {
        ownLastTs = Math.max(ownLastTs, event.getTs());
        return;
      }
    }
  };
  scan(room.getLiveTimeline().getEvents());
  threads.forEach((thread) => scan(thread.events));
  return ownLastTs;
};

const recount = (
  mx: MatrixClient,
  room: Room,
  finishingEdit: (reply: MatrixEvent) => MatrixEvent | undefined
): void => {
  const userId = mx.getUserId();
  if (!userId) return;
  const threads = room.getThreads();
  const ownLastTs = ownLastTsOf(room, threads, userId);
  const count = (context: Room | Thread, events: readonly MatrixEvent[], threadId?: string) =>
    countContext(
      mx,
      room,
      events,
      threadId,
      readUpTo(room, context, userId, ownLastTs),
      userId,
      finishingEdit
    );
  setCounts(room, undefined, count(room, room.getLiveTimeline().getEvents()));
  threads.forEach((thread) => setCounts(room, thread.id, count(thread, thread.events, thread.id)));
};

/**
 * Keeps the unread counts of the client's encrypted rooms in line with the server's rules for the
 * events the client can read; call it before the client starts. Returns a function that stops it.
 */
export const keepEncryptedRoomCounts = (mx: MatrixClient): (() => void) => {
  // The edits that finished replies, by reply: the SDK puts an edit on its reply only once it
  // decrypted it, and not on a reply it does not hold yet.
  const finishingEdits = new Map<string, MatrixEvent>();
  const finishingEdit = (reply: MatrixEvent): MatrixEvent | undefined => {
    const replyId = reply.getId();
    const candidates = [reply.replacingEvent(), replyId ? finishingEdits.get(replyId) : undefined];
    return candidates.reduce<MatrixEvent | undefined>((newest, edit) => {
      if (!edit || edit.getSender() !== reply.getSender() || !isFinishingEdit(edit)) return newest;
      return !newest || edit.getTs() > newest.getTs() ? edit : newest;
    }, undefined);
  };
  const rememberEdit = (event: MatrixEvent) => {
    const relation = relationOf(event);
    if (relation?.rel_type !== RelationType.Replace || typeof relation.event_id !== 'string')
      return;
    if (!isFinishingEdit(event)) return;
    if (finishingEdits.size >= FINISHING_EDITS_LIMIT) finishingEdits.clear();
    finishingEdits.set(relation.event_id, event);
  };

  const queued = new Set<string>();
  const schedule = (roomId: string | undefined) => {
    if (!roomId || queued.has(roomId)) return;
    queued.add(roomId);
    queueMicrotask(() => {
      queued.delete(roomId);
      const room = mx.getRoom(roomId);
      if (room?.hasEncryptionStateEvent()) recount(mx, room, finishingEdit);
    });
  };
  const onEvent = (event: MatrixEvent) => {
    rememberEdit(event);
    schedule(event.getRoomId());
  };
  const onRoomChange = (_event: MatrixEvent, room: Room | undefined) => schedule(room?.roomId);

  // An event can reach its thread after the sync announced it, so a timeline change counts too.
  mx.on(ClientEvent.Event, onEvent);
  mx.on(MatrixEventEvent.Decrypted, onEvent);
  mx.on(RoomEvent.Timeline, onEvent);
  mx.on(RoomEvent.Redaction, onRoomChange);
  mx.on(RoomEvent.Receipt, onRoomChange);
  return () => {
    mx.removeListener(ClientEvent.Event, onEvent);
    mx.removeListener(MatrixEventEvent.Decrypted, onEvent);
    mx.removeListener(RoomEvent.Timeline, onEvent);
    mx.removeListener(RoomEvent.Redaction, onRoomChange);
    mx.removeListener(RoomEvent.Receipt, onRoomChange);
  };
};
