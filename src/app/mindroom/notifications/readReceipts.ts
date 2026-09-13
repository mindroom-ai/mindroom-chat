import { Direction, MatrixClient, MatrixEvent, RelationType, Room, ReceiptType } from 'matrix-js-sdk';
import { MAIN_ROOM_TIMELINE } from 'matrix-js-sdk/lib/@types/read_receipts';
import { isThreadOnlyRoomActivity } from '../threads/threadRenderUtils';
import { eventBelongsToThread } from '../threads/threadUtils';

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
    if (!isEligible(event) || event.isSending()) continue;
    return event;
  }
  return undefined;
};

const isThreadReplyReceiptTarget = (event: MatrixEvent, threadId: string): boolean =>
  event.getId() !== threadId &&
  eventBelongsToThread(event, threadId) &&
  event.getRelation()?.rel_type === RelationType.Thread;

const getLoadedThreadReplyTarget = (
  room: Room,
  threadId: string,
  readEventId: string | null
): MatrixEvent | undefined => {
  const thread = room.getThread(threadId);
  if (thread) {
    return getLatestReceiptTarget(thread.events, readEventId, (event) =>
      isThreadReplyReceiptTarget(event, threadId)
    );
  }

  return getLatestReceiptTarget(room.getLiveTimeline().getEvents(), readEventId, (event) =>
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
    const readEventId = userId ? thread.getEventReadUpTo(userId) : null;
    return getLoadedThreadReplyTarget(room, threadId, readEventId);
  }

  const relationResponse = await mx.fetchRelations(room.roomId, threadId, RelationType.Thread, null, {
    dir: Direction.Backward,
    limit: 1,
  });
  const latestReply = relationResponse.chunk?.[0];
  if (!latestReply) {
    return undefined;
  }

  const mappedReply = mx.getEventMapper()(latestReply);
  if (mappedReply.isSending() || !isThreadReplyReceiptTarget(mappedReply, threadId)) {
    return getLoadedThreadReplyTarget(room, threadId, null);
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

  const latestEvent = getLatestReceiptTarget(timeline, room.getEventReadUpTo(userId), (event) =>
    !isThreadOnlyRoomActivity(room, event)
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
  if (timeline.length === 0) return;

  const latestEvent = getLatestReceiptTarget(timeline, null);
  if (!latestEvent) return;

  await mx.sendReadReceipt(latestEvent, getReceiptType(privateReceipt), true);
}
