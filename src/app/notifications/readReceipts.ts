import {
  Direction,
  EventStatus,
  type MatrixClient,
  MatrixEvent,
  ReceiptType,
  RelationType,
  type Room,
} from 'matrix-js-sdk';
import { MAIN_ROOM_TIMELINE } from 'matrix-js-sdk/lib/@types/read_receipts';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import { inMainTimelineForReceipt } from 'matrix-js-sdk/lib/client';
import { getThreadReadState } from '../event-store/threads/roomThreadList';
import { getFinishingEdit, threadReceiptNamesEvent } from '../event-store/threads/streamFinish';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import { isVisibleThreadReplyEvent } from '../event-store/threads/threadUtils';
import { getMainTimelineReadTs } from '../matrix/mainTimelineRead';
import { hasTerminalStreamMetadata } from '../matrix/protocol/aiRun';
import { getThreadRootReadAction } from '../matrix/room';
import { forgetReadThreadRoots, rememberSeenThreadRoot } from '../matrix/seenThreadRoots';

const receiptTypeFor = (hideActivity: boolean): ReceiptType =>
  hideActivity ? ReceiptType.ReadPrivate : ReceiptType.Read;

/** Only events the server has accepted can take a receipt. */
const isConfirmed = (event: MatrixEvent | undefined): event is MatrixEvent => {
  if (!event || !isConfirmedMatrixEventId(event.getId())) return false;
  const status = event.status;
  return status === null || status === undefined || status === EventStatus.SENT;
};

/** The newer of two events; on equal timestamps, `preferred`. */
const newer = (
  current: MatrixEvent | undefined,
  preferred: MatrixEvent | undefined
): MatrixEvent | undefined => {
  if (!current) return preferred;
  if (!preferred) return current;
  return preferred.getTs() >= current.getTs() ? preferred : current;
};

const isConfirmedReply = (event: MatrixEvent): boolean =>
  isConfirmed(event) && isVisibleThreadReplyEvent(event);

/**
 * The edit that finished a reply streamed in a thread. The server counts the finished reply as
 * new, so a receipt must reach it; earlier edits of the stream need none, and an edit of the root
 * belongs to the main timeline.
 */
const isConfirmedFinishingEdit = (event: MatrixEvent): boolean =>
  isConfirmed(event) &&
  event.isRelation(RelationType.Replace) &&
  !!event.threadRootId &&
  !inMainTimelineForReceipt(event) &&
  hasTerminalStreamMetadata(event.getContent());

/** The confirmed edit that finished `reply` (`getFinishingEdit`). */
const finishingEditOf = (reply: MatrixEvent, thread: Thread): MatrixEvent | undefined => {
  const edit = getFinishingEdit(reply, thread);
  return isConfirmed(edit) ? edit : undefined;
};

/**
 * A thread's newest confirmed reply, or edit that finished one: the last loaded one or the reply
 * the server's summary names, whichever is newer, or the edit that finished that reply. The
 * summary wins a tie, since it is the server's view of the tail.
 */
const latestThreadReply = (thread: Thread): MatrixEvent | undefined => {
  const loaded = thread.events?.findLast(
    (event) => isConfirmedReply(event) || isConfirmedFinishingEdit(event)
  );
  const summary = thread.replyToEvent ?? undefined;
  const tail = newer(loaded, summary && isConfirmedReply(summary) ? summary : undefined);
  return tail && !tail.isRelation(RelationType.Replace) ? newer(tail, finishingEditOf(tail, thread)) : tail;
};

const send = (promise: Promise<unknown> | undefined): Promise<void> =>
  Promise.resolve(promise).then(
    () => undefined,
    // A receipt that fails to send is retried by the next read; it is never worth an error.
    () => undefined
  );

/**
 * Reads the room's main timeline: a `main` receipt on its newest event outside threads.
 * Thread replies stay unread.
 */
export const markMainTimelineAsRead = async (
  mx: MatrixClient,
  roomId: string,
  hideActivity: boolean
): Promise<void> => {
  const room = mx.getRoom(roomId);
  const events = room?.getLiveTimeline().getEvents() ?? [];
  // An edit or reaction belongs where its target does: one whose target is a thread reply, or is
  // not loaded and may be one, would make the server refuse a main receipt.
  const byId = new Map(events.map((event) => [event.getId(), event]));
  const relatesToMain = (event: MatrixEvent) => {
    const targetId = event.relationEventId;
    if (!targetId) return true;
    const relatedTo = byId.get(targetId);
    return !!relatedTo && inMainTimelineForReceipt(relatedTo);
  };
  const target = events.findLast(
    (event) => isConfirmed(event) && inMainTimelineForReceipt(event) && relatesToMain(event)
  );
  if (!room || !target) return;
  const userId = mx.getUserId();
  if (userId && room.getEventReadUpTo(userId) === target.getId()) return;
  await send(
    mx.sendReceipt(target, receiptTypeFor(hideActivity), { thread_id: MAIN_ROOM_TIMELINE })
  );
};

const fetchNewestRelation = async (
  mx: MatrixClient,
  roomId: string,
  parentId: string,
  relationType: RelationType
): Promise<MatrixEvent | undefined> => {
  try {
    const response = await mx.fetchRelations(roomId, parentId, relationType, null, {
      dir: Direction.Backward,
      limit: 1,
    });
    const raw = response.chunk[0];
    return raw ? mx.getEventMapper()(raw) : undefined;
  } catch {
    return undefined;
  }
};

/** The server's newest reply in the thread, or the edit that finished it when it was streamed. */
const fetchThreadTail = async (
  mx: MatrixClient,
  roomId: string,
  rootId: string
): Promise<MatrixEvent | undefined> => {
  const reply = await fetchNewestRelation(mx, roomId, rootId, RelationType.Thread);
  const replyId = reply?.getId();
  if (!reply || !replyId) return reply;
  const edit = await fetchNewestRelation(mx, roomId, replyId, RelationType.Replace);
  return edit && hasTerminalStreamMetadata(edit.getContent()) ? newer(reply, edit) : reply;
};

/**
 * `event` as the SDK needs it for a receipt in thread `rootId` of room `roomId`: the SDK sets the
 * receipt's `thread_id` from the event's own thread and builds the request path from its room. An
 * edit fetched from the server or bundled with its reply can lack both; its receipt would go to
 * the main timeline, which the server refuses for an edit of a thread reply, or to no room.
 */
const forThreadReceipt = (event: MatrixEvent, roomId: string, rootId: string): MatrixEvent => {
  if (event.threadRootId === rootId && event.getRoomId() === roomId) return event;
  const copy = new MatrixEvent({ ...event.event, room_id: roomId });
  copy.setThreadId(rootId);
  return copy;
};

/** Whether the reader's receipt in the thread, public or private, already names `eventId`. */
const threadReceiptNames = (thread: Thread, userId: string | undefined, eventId: string) =>
  !!getThreadReadState(thread, userId)?.readEventIds.has(eventId) ||
  (!!userId && threadReceiptNamesEvent(thread, userId, eventId));

/**
 * Reads the root of an opened thread, which belongs to the main timeline: a main receipt once
 * nothing else there is unread, else a record on this device (see `getThreadRootReadAction`).
 * Never an unthreaded receipt, which would read every thread.
 */
const markThreadRootAsRead = async (
  mx: MatrixClient,
  room: Room,
  rootId: string,
  hideActivity: boolean
): Promise<void> => {
  const userId = mx.getUserId();
  const root = room.findEventById(rootId) ?? room.getThread(rootId)?.rootEvent;
  if (!userId || !isConfirmed(root)) return;
  const action = getThreadRootReadAction(mx, room, root);
  if (action === 'seen') {
    rememberSeenThreadRoot(userId, room.roomId, root, getMainTimelineReadTs(room, userId));
  } else if (action === 'receipt') {
    await markMainTimelineAsRead(mx, room.roomId, hideActivity);
    // The receipt's local echo moved the read time past the roots seen before.
    forgetReadThreadRoots(userId, room.roomId, getMainTimelineReadTs(room, userId));
  }
};

/**
 * Reads one thread: its root (`markThreadRootAsRead`), then a receipt scoped to the thread on its
 * newest reply or the edit that finished one (`latestThreadReply`), or on `seen`, an event of the
 * thread the reader saw arrive, when that is newer. When the SDK's thread model knows neither, the
 * server's latest reply is fetched. A reply the user already read gets no new receipt.
 */
export const markThreadAsRead = async (
  mx: MatrixClient,
  roomId: string,
  rootId: string,
  hideActivity: boolean,
  seen?: MatrixEvent
): Promise<void> => {
  // A thread still being created has nothing the server could acknowledge.
  if (!isConfirmedMatrixEventId(rootId)) return;
  const room = mx.getRoom(roomId);
  if (!room) return;
  // The root first, so views that update on the thread receipt find the root read too.
  await markThreadRootAsRead(mx, room, rootId, hideActivity);
  const thread = room.getThread(rootId);
  const target =
    newer(thread ? latestThreadReply(thread) : undefined, isConfirmed(seen) ? seen : undefined) ??
    (await fetchThreadTail(mx, roomId, rootId)) ??
    room
      .getLiveTimeline()
      .getEvents()
      .findLast((event) => isConfirmedReply(event) && event.threadRootId === rootId);
  const targetId = target?.getId();
  if (!target || !targetId || !isConfirmed(target)) return;
  if (thread && threadReceiptNames(thread, mx.getUserId() ?? undefined, targetId)) return;
  await send(
    mx.sendReceipt(forThreadReceipt(target, roomId, rootId), receiptTypeFor(hideActivity), {
      thread_id: rootId,
    })
  );
};

const latestRoomEvent = (room: Room): MatrixEvent | undefined => {
  let latest: MatrixEvent | undefined = room.getLiveTimeline().getEvents().findLast(isConfirmed);
  room.getThreads().forEach((thread) => {
    // A thread's tail wins a tie with a main event: it is what the room still shows as unread.
    latest = newer(latest, latestThreadReply(thread));
  });
  return latest;
};

/**
 * Reads the whole room, threads included: an unthreaded receipt on the newest event the client
 * knows of, in the main timeline or any thread. It is sent even when the main timeline is
 * already read, since only an unthreaded receipt clears the threads.
 */
export const markRoomAndThreadsAsRead = async (
  mx: MatrixClient,
  roomId: string,
  hideActivity: boolean
): Promise<void> => {
  const room = mx.getRoom(roomId);
  if (!room) return;
  const target = latestRoomEvent(room);
  if (!target) return;
  await send(mx.sendReadReceipt(target, receiptTypeFor(hideActivity), true));
};
