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
import { getStreamStatusFromContent, TERMINAL_STREAM_STATUSES } from '../protocol/aiRun';
import { isRecord } from '../../lib/isRecord';
import { receiptReadTs, unthreadedReceiptReadTs } from '../receiptReadTs';
import { getFinishingEdit } from './syncedEdits';

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
// up to the event it names (mindroom-tuwunel #140: an older receipt leaves the events after its
// event unread), an unthreaded receipt (it reads every context), an event of the user's own in the
// context (mindroom-tuwunel #139: one in a thread reads that thread, any other the main timeline;
// a state event reads nothing), or the user's own join, which reads the whole room. A reply that
// streams counts as
// one message once its terminal edit arrives, at that edit's time; the reply's first event, its
// other edits and reactions count as nothing. The thread's title notice counts on the server,
// whose push rules cannot read it, but not here, where they can (design decision #17).

/** Relations that never count as unread messages of their own. */
const UNCOUNTED_RELATIONS: ReadonlySet<string> = new Set([
  RelationType.Replace,
  RelationType.Annotation,
]);

type Counts = { total: number; highlight: number };

const relationOf = (event: MatrixEvent): Record<string, unknown> | undefined => {
  // Relations stay unencrypted, so the wire content has them before decryption too.
  const relation: unknown = event.getWireContent()['m.relates_to'];
  return isRecord(relation) ? relation : undefined;
};

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
 * it: the newest of its receipts there and its unthreaded receipt, each up to the event it names,
 * and `ownReadTs`, its own last event there or its join.
 */
const readUpTo = (
  room: Room,
  context: Room | Thread,
  userId: string,
  ownReadTs: number
): number => {
  let readTs = Math.max(ownReadTs, unthreadedReceiptReadTs(room, userId, context) ?? -Infinity);
  [ReceiptType.Read, ReceiptType.ReadPrivate].forEach((receiptType) => {
    [true, false].forEach((realOnly) => {
      const receipt = context.getReadReceiptForUserId(userId, realOnly, receiptType);
      if (!receipt) return;
      readTs = Math.max(readTs, receiptReadTs(room, context, receipt.eventId, receipt.data.ts));
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
  userId: string
): Counts => {
  const counts: Counts = { total: 0, highlight: 0 };
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.getId() === threadId) continue;
    const streamed = isStreamedReply(event);
    if (streamed && event.getSender() !== userId) {
      const edit = getFinishingEdit(event);
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

/** Sets a context's counts; each change announces itself, so only changes are set. */
const setCounts = (room: Room, threadId: string | undefined, counts: Counts): void => {
  const set = (type: NotificationCountType, value: number) => {
    if (threadId) {
      if (room.getThreadUnreadNotificationCount(threadId, type) !== value) {
        room.setThreadUnreadNotificationCount(threadId, type, value);
      }
    } else if (room.getRoomUnreadNotificationCount(type) !== value) {
      room.setUnreadNotificationCount(type, value);
    }
  };
  set(NotificationCountType.Total, counts.total);
  set(NotificationCountType.Highlight, counts.highlight);
};

/** When the user joined the room, which reads all of it; a profile change reads nothing. */
const ownJoinTsOf = (room: Room, userId: string): number => {
  const member = room.currentState.getStateEvents(EventType.RoomMember, userId);
  const joined = (content: Record<string, unknown> | undefined) => content?.membership === 'join';
  return member && joined(member.getContent()) && !joined(member.getPrevContent())
    ? member.getTs()
    : -Infinity;
};

/** The newest event of the user's own in a context, which reads the context; not its root. */
const ownLastTsIn = (events: readonly MatrixEvent[], userId: string, threadId?: string): number => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.getSender() === userId && !event.isState() && event.getId() !== threadId) {
      return event.getTs();
    }
  }
  return -Infinity;
};

const recount = (mx: MatrixClient, room: Room): void => {
  const userId = mx.getUserId();
  if (!userId) return;
  const threads = room.getThreads();
  const ownJoinTs = ownJoinTsOf(room, userId);
  const count = (context: Room | Thread, events: readonly MatrixEvent[], threadId?: string) =>
    countContext(
      mx,
      room,
      events,
      threadId,
      readUpTo(room, context, userId, Math.max(ownJoinTs, ownLastTsIn(events, userId, threadId))),
      userId
    );
  setCounts(room, undefined, count(room, room.getLiveTimeline().getEvents()));
  threads.forEach((thread) => setCounts(room, thread.id, count(thread, thread.events, thread.id)));
};

/**
 * Keeps the unread counts of the client's encrypted rooms in line with the server's rules for the
 * events the client can read; call it before the client starts. Returns a function that stops it.
 */
export const keepEncryptedRoomCounts = (mx: MatrixClient): (() => void) => {
  const queued = new Set<string>();
  const schedule = (roomId: string | undefined) => {
    if (!roomId || queued.has(roomId)) return;
    queued.add(roomId);
    queueMicrotask(() => {
      queued.delete(roomId);
      const room = mx.getRoom(roomId);
      if (room?.hasEncryptionStateEvent()) recount(mx, room);
    });
  };
  const onEvent = (event: MatrixEvent) => schedule(event.getRoomId());
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
