import {
  Direction,
  MatrixClient,
  MatrixEvent,
  RelationType,
  Room,
  ReceiptType,
  type Thread,
} from 'matrix-js-sdk';
import { MAIN_ROOM_TIMELINE } from 'matrix-js-sdk/lib/@types/read_receipts';
import { isThreadOnlyRoomActivity } from '../threads/threadRenderUtils';
import { isLocalEchoEventId } from '../threads/threadRouteUtils';
import { eventBelongsToThread } from '../threads/threadUtils';
import { getThreadReadUpToTs } from '../threads/roomThreadList';

const getReceiptType = (privateReceipt: boolean): ReceiptType =>
  privateReceipt ? ReceiptType.ReadPrivate : ReceiptType.Read;

const getLatestReceiptTarget = (
  events: MatrixEvent[],
  readEventId: string | null,
  isEligible: (event: MatrixEvent) => boolean = () => true
): MatrixEvent | undefined => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.getId() === readEventId) return undefined;
    if (
      !event.getId() ||
      isLocalEchoEventId(event.getId()) ||
      !isEligible(event) ||
      event.isSending()
    )
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
  return summaryReply && (!loadedReply || summaryReply.getTs() > loadedReply.getTs())
    ? summaryReply
    : loadedReply;
};

const getLoadedThreadReplyTarget = (room: Room, threadId: string): MatrixEvent | undefined => {
  const thread = room.getThread(threadId);
  if (thread) {
    return getThreadReplyTarget(thread);
  }

  return getLatestReceiptTarget(room.getLiveTimeline().getEvents(), null, (event) =>
    isThreadReplyReceiptTarget(event, threadId)
  );
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
    const readUpToTs = getThreadReadUpToTs(thread, userId ?? undefined);
    return latestReply && (readUpToTs === undefined || latestReply.getTs() > readUpToTs)
      ? latestReply
      : undefined;
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
    return getLoadedThreadReplyTarget(room, threadId);
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
  if (!latestReply) return;

  await mx.sendReceipt(latestReply, getReceiptType(privateReceipt), {
    thread_id: threadId,
  });
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
    if (reply && (!latestEvent || reply.getTs() > latestEvent.getTs())) latestEvent = reply;
  }
  if (!latestEvent) return;

  await mx.sendReadReceipt(latestEvent, getReceiptType(privateReceipt), true);
}
