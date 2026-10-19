import {
  Direction,
  MatrixClient,
  MatrixEvent,
  MsgType,
  NotificationCountType,
  RelationType,
  Room,
  ReceiptType,
  type Thread,
} from 'matrix-js-sdk';
import { MAIN_ROOM_TIMELINE } from 'matrix-js-sdk/lib/@types/read_receipts';
import { isThreadOnlyRoomActivity } from '../threads/threadRenderUtils';
import { isLocalEchoEventId } from '../threads/threadRouteUtils';
import { eventBelongsToThread } from '../threads/threadUtils';
import { getThreadReadState, getThreadUnread } from '../threads/roomThreadList';

const getReceiptType = (privateReceipt: boolean): ReceiptType =>
  privateReceipt ? ReceiptType.ReadPrivate : ReceiptType.Read;

const getLatestReceiptTarget = (
  events: MatrixEvent[],
  readEventId: string | null,
  isEligible: (event: MatrixEvent) => boolean = () => true
): MatrixEvent | undefined => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    const eventId = event.getId();
    if (eventId === readEventId) return undefined;
    if (!eventId || isLocalEchoEventId(eventId) || !isEligible(event) || event.isSending())
      continue;
    return event;
  }
  return undefined;
};

const isThreadReplyReceiptTarget = (event: MatrixEvent, threadId: string): boolean =>
  event.getId() !== threadId &&
  eventBelongsToThread(event, threadId) &&
  event.getRelation()?.rel_type === RelationType.Thread;

const getThreadReplyTarget = (thread: Thread): MatrixEvent | undefined => {
  const isEligible = (event: MatrixEvent) => isThreadReplyReceiptTarget(event, thread.id);
  const loadedReply = getLatestReceiptTarget(thread.events, null, isEligible);
  // Before history is loaded, the SDK keeps the bundled latest reply outside events.
  const replyToEvent = thread.replyToEvent;
  const summaryReply = replyToEvent
    ? getLatestReceiptTarget([replyToEvent], null, isEligible)
    : undefined;
  return summaryReply && (!loadedReply || summaryReply.getTs() >= loadedReply.getTs())
    ? summaryReply
    : loadedReply;
};

const getLatestThreadReplyTarget = async (
  mx: MatrixClient,
  room: Room,
  threadId: string
): Promise<MatrixEvent | undefined> => {
  const userId = mx.getUserId();
  const thread = room.getThread(threadId);
  if (thread) {
    const latestReply = getThreadReplyTarget(thread);
    if (!latestReply) return undefined;
    const readState = getThreadReadState(thread, userId ?? undefined);
    if (readState?.readEventIds.has(latestReply.getId()!)) return undefined;
    // Equal timestamps do not prove that distinct events have been acknowledged.
    if (readState?.readUpToTs !== undefined && latestReply.getTs() < readState.readUpToTs) {
      return undefined;
    }
    return latestReply;
  }

  const relationResponse = await mx.fetchRelations(
    room.roomId,
    threadId,
    RelationType.Thread,
    null,
    {
      dir: Direction.Backward,
      limit: 1,
    }
  );
  const latestReply = relationResponse.chunk?.[0];
  if (!latestReply) {
    return undefined;
  }

  const mappedReply = mx.getEventMapper()(latestReply);
  if (mappedReply.isSending() || !isThreadReplyReceiptTarget(mappedReply, threadId)) {
    const loadedThread = room.getThread(threadId);
    return loadedThread
      ? getThreadReplyTarget(loadedThread)
      : getLatestReceiptTarget(room.getLiveTimeline().getEvents(), null, (event) =>
          isThreadReplyReceiptTarget(event, threadId)
        );
  }

  return mappedReply;
};

export async function markMainTimelineAsRead(
  mx: MatrixClient,
  roomId: string,
  privateReceipt: boolean
) {
  const room = mx.getRoom(roomId);
  const userId = mx.getUserId();
  if (!room || !userId) return;

  const timeline = room.getLiveTimeline().getEvents();
  if (timeline.length === 0) return;

  const latestEvent = getLatestReceiptTarget(
    timeline,
    room.getEventReadUpTo(userId),
    (event) => !isThreadOnlyRoomActivity(room, event)
  );
  if (!latestEvent) return;

  await mx.sendReceipt(latestEvent, getReceiptType(privateReceipt), {
    thread_id: MAIN_ROOM_TIMELINE,
  });
}

export async function markThreadAsRead(
  mx: MatrixClient,
  roomId: string,
  threadId: string,
  privateReceipt: boolean
) {
  if (isLocalEchoEventId(threadId)) return;

  const room = mx.getRoom(roomId);
  if (!room) return;

  const latestReply = await getLatestThreadReplyTarget(mx, room, threadId);
  if (latestReply) {
    await mx.sendReceipt(latestReply, getReceiptType(privateReceipt), {
      thread_id: threadId,
    });
  }
  await markThreadRootAsRead(mx, room, threadId, privateReceipt);
}

/**
 * A thread's root is in the main timeline, which a threaded receipt does not reach, so a root posted
 * by someone else keeps counting after its thread is read. Acknowledge it there only when the
 * server counts it as the room's one main notification and no other thread has unread replies: a
 * room receipt reads every main message before it, and thread replies older than it too.
 */
async function markThreadRootAsRead(
  mx: MatrixClient,
  room: Room,
  threadId: string,
  privateReceipt: boolean
) {
  const userId = mx.getUserId();
  const root = room.findEventById(threadId) ?? room.getThread(threadId)?.rootEvent;
  if (!userId || !root || root.getSender() === userId || root.isSending()) return;
  if (root.getContent().msgtype === MsgType.Notice) return;
  if (!mx.getPushActionsForEvent(root)?.notify) return;
  const readUpToId = room.getEventReadUpTo(userId);
  if (!readUpToId && room.getLastUnthreadedReceiptFor(userId)) return;
  const readUpToTs = readUpToId ? room.findEventById(readUpToId)?.getTs() : undefined;
  if (readUpToId === threadId || (readUpToTs !== undefined && root.getTs() < readUpToTs)) return;

  const mainCount = room.getRoomUnreadNotificationCount(NotificationCountType.Total);
  const otherThreadsCount =
    room.getUnreadNotificationCount(NotificationCountType.Total) -
    mainCount -
    room.getThreadUnreadNotificationCount(threadId, NotificationCountType.Total);
  if (mainCount !== 1 || otherThreadsCount > 0) return;
  if (room.getThreads().some((t) => t.id !== threadId && getThreadUnread(room, t, userId))) return;

  await mx.sendReceipt(root, getReceiptType(privateReceipt), { thread_id: MAIN_ROOM_TIMELINE });
}

export async function markRoomAndThreadsAsRead(
  mx: MatrixClient,
  roomId: string,
  privateReceipt: boolean
) {
  const room = mx.getRoom(roomId);
  const userId = mx.getUserId();
  if (!room || !userId) return;

  const timeline = room.getLiveTimeline().getEvents();
  let latestEvent = getLatestReceiptTarget(timeline, null);
  for (const thread of room.getThreads()) {
    const reply = getThreadReplyTarget(thread);
    if (reply && (!latestEvent || reply.getTs() >= latestEvent.getTs())) latestEvent = reply;
  }
  if (!latestEvent) return;

  await mx.sendReadReceipt(latestEvent, getReceiptType(privateReceipt), true);
}
