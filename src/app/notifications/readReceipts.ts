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
import { getFinishingEdit } from '../event-store/threads/streamFinish';
import { isConfirmedMatrixEventId } from '../event-store/threads/threadRouteUtils';
import { isVisibleThreadReplyEvent } from '../event-store/threads/threadUtils';
import { getMainTimelineReadTs } from '../matrix/mainTimelineRead';
import { hasTerminalStreamMetadata } from '../matrix/protocol/aiRun';
import { getThreadRootReadAction } from '../matrix/room';
import { sendOwnReceipt } from '../matrix/state/roomToUnread';
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
  // A summary reply the thread holds is at or before the last loaded event in stream order,
  // whatever the timestamps say.
  const summaryLoaded = !!summary && !!thread.events?.some((e) => e.getId() === summary.getId());
  const tail = summaryLoaded
    ? loaded
    : newer(loaded, summary && isConfirmedReply(summary) ? summary : undefined);
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
    sendOwnReceipt(() =>
      mx.sendReceipt(target, receiptTypeFor(hideActivity), { thread_id: MAIN_ROOM_TIMELINE })
    )
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
  // The server bundles the reply's newest edit with it; only without one is it asked for.
  const bundled = getFinishingEdit(reply);
  if (bundled) return bundled;
  const edit = await fetchNewestRelation(mx, roomId, replyId, RelationType.Replace);
  return edit && hasTerminalStreamMetadata(edit.getContent()) ? newer(reply, edit) : reply;
};

/**
 * `event` as the SDK needs it for a receipt in room `roomId`: the SDK builds the request path from
 * the event's room, and an edit the server bundles with its reply carries none.
 */
const inRoom = (event: MatrixEvent, roomId: string): MatrixEvent =>
  event.getRoomId() === roomId ? event : new MatrixEvent({ ...event.event, room_id: roomId });

/**
 * `event` as the SDK needs it for a receipt in thread `rootId` of room `roomId` (`inRoom`): the
 * SDK also sets the receipt's `thread_id` from the event's own thread. An edit fetched from the
 * server or bundled with its reply has none, so its receipt would go to the main timeline, which
 * the server refuses for an edit of a thread reply.
 */
const forThreadReceipt = (event: MatrixEvent, roomId: string, rootId: string): MatrixEvent => {
  if (event.threadRootId === rootId && event.getRoomId() === roomId) return event;
  const copy = new MatrixEvent({ ...event.event, room_id: roomId });
  copy.setThreadId(rootId);
  return copy;
};

/**
 * Whether the reader's receipt in the thread, public or private, already reads `target`: it names
 * `target`, an event after it in the thread, or the edit that finished it. A receipt never moves
 * back, so none is sent then, though timestamps may tie.
 */
const threadReceiptReads = (thread: Thread, userId: string | undefined, target: MatrixEvent) => {
  const targetId = target.getId();
  if (!targetId || getThreadReadState(thread, userId)?.readEventIds.has(targetId)) return true;
  if (!userId) return false;
  const events = thread.events ?? [];
  const position = (eventId: string | undefined) =>
    events.findIndex((event) => event.getId() === eventId);
  const targetPosition = position(targetId);
  const finishId = getFinishingEdit(target, thread)?.getId();
  return [ReceiptType.Read, ReceiptType.ReadPrivate].some((type) => {
    const receiptId = thread.getReadReceiptForUserId(userId, false, type)?.eventId;
    if (!receiptId) return false;
    if (receiptId === targetId || receiptId === finishId) return true;
    return targetPosition >= 0 && position(receiptId) > targetPosition;
  });
};

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
 * What a view that renders the thread's `shown` events has read: the newest reply among them, or
 * the edit that finished it. A view that renders no reply has read none.
 */
const reachedReply = (
  shown: readonly MatrixEvent[],
  thread: Thread | null
): MatrixEvent | undefined => {
  const reply = shown.findLast(isConfirmedReply);
  return reply && thread ? newer(reply, finishingEditOf(reply, thread)) : reply;
};

/**
 * Reads one thread: its root (`markThreadRootAsRead`), then a receipt scoped to the thread on its
 * newest reply or the edit that finished one (`latestThreadReply`), or on `seen`, an event of the
 * thread the reader saw arrive, when that is newer. When the SDK's thread model knows neither, the
 * server's latest reply is fetched. A reply the user already read gets no new receipt. With
 * `shown`, the thread's events the reader's view renders, the receipt reads up to the newest
 * reply among them only (`reachedReply`): the thread model can know replies not rendered yet.
 */
export const markThreadAsRead = async (
  mx: MatrixClient,
  roomId: string,
  rootId: string,
  hideActivity: boolean,
  seen?: MatrixEvent,
  shown?: readonly MatrixEvent[]
): Promise<void> => {
  // A thread still being created has nothing the server could acknowledge.
  if (!isConfirmedMatrixEventId(rootId)) return;
  const room = mx.getRoom(roomId);
  if (!room) return;
  // What the reader has seen is taken now: an edit that arrives while the root is read was not.
  const thread = room.getThread(rootId);
  const known = newer(
    thread ? latestThreadReply(thread) : undefined,
    isConfirmed(seen) ? seen : undefined
  );
  // The root first, so views that update on the thread receipt find the root read too.
  await markThreadRootAsRead(mx, room, rootId, hideActivity);
  const target = shown
    ? reachedReply(shown, thread)
    : known ??
      (await fetchThreadTail(mx, roomId, rootId)) ??
      room
        .getLiveTimeline()
        .getEvents()
        .findLast((event) => isConfirmedReply(event) && event.threadRootId === rootId);
  const targetId = target?.getId();
  if (!target || !targetId || !isConfirmed(target)) return;
  if (thread && threadReceiptReads(thread, mx.getUserId() ?? undefined, target)) return;
  await send(
    sendOwnReceipt(() =>
      mx.sendReceipt(forThreadReceipt(target, roomId, rootId), receiptTypeFor(hideActivity), {
        thread_id: rootId,
      })
    )
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
  await send(
    sendOwnReceipt(() =>
      mx.sendReadReceipt(inRoom(target, roomId), receiptTypeFor(hideActivity), true)
    )
  );
};
