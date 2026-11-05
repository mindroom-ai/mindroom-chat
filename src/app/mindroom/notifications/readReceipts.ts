import {
  Direction,
  EventStatus,
  type MatrixClient,
  type MatrixEvent,
  ReceiptType,
  RelationType,
  type Room,
} from 'matrix-js-sdk';
import { MAIN_ROOM_TIMELINE } from 'matrix-js-sdk/lib/@types/read_receipts';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import { inMainTimelineForReceipt } from 'matrix-js-sdk/lib/client';
import { getThreadReadState } from '../threads/roomThreadList';
import { isConfirmedMatrixEventId } from '../threads/threadRouteUtils';
import { isVisibleThreadReplyEvent } from '../threads/threadUtils';
import { getMainTimelineReadTs } from '../../utils/mainTimelineRead';
import { getThreadRootReadAction } from '../../utils/room';
import { forgetReadThreadRoots, rememberSeenThreadRoot } from '../../utils/seenThreadRoots';

const receiptTypeFor = (privateReceipt: boolean): ReceiptType =>
  privateReceipt ? ReceiptType.ReadPrivate : ReceiptType.Read;

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
 * A thread's newest confirmed reply: the last loaded one or the reply the server's summary
 * names, whichever is newer. The summary wins a tie, since it is the server's view of the tail.
 */
const latestThreadReply = (thread: Thread): MatrixEvent | undefined => {
  const loaded = thread.events?.findLast(isConfirmedReply);
  const summary = thread.replyToEvent ?? undefined;
  return newer(loaded, summary && isConfirmedReply(summary) ? summary : undefined);
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
  privateReceipt: boolean
): Promise<void> => {
  const room = mx.getRoom(roomId);
  if (!room) return;
  const target = room
    .getLiveTimeline()
    .getEvents()
    .findLast((event) => isConfirmed(event) && inMainTimelineForReceipt(event));
  if (!target) return;
  const userId = mx.getUserId();
  if (userId && room.getEventReadUpTo(userId) === target.getId()) return;
  await send(
    mx.sendReceipt(target, receiptTypeFor(privateReceipt), { thread_id: MAIN_ROOM_TIMELINE })
  );
};

const fetchThreadTail = async (
  mx: MatrixClient,
  roomId: string,
  threadId: string
): Promise<MatrixEvent | undefined> => {
  try {
    const response = await mx.fetchRelations(roomId, threadId, RelationType.Thread, null, {
      dir: Direction.Backward,
      limit: 1,
    });
    const raw = response.chunk[0];
    return raw ? mx.getEventMapper()(raw) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Whether the user has no thread receipt in the room yet. Until they do, the SDK counts every
 * loaded reply as read (its rule for accounts from before thread receipts), so no reply could
 * ever show as unread there.
 */
const lacksThreadReceipt = (room: Room): boolean =>
  room.getOldestThreadedReceiptTs?.() === Number.POSITIVE_INFINITY;

/**
 * Reads the root of an opened thread, which belongs to the main timeline: a main receipt once
 * nothing else there is unread, else a record on this device (see `getThreadRootReadAction`).
 * Never an unthreaded receipt, which would read every thread.
 */
const markThreadRootAsRead = async (
  mx: MatrixClient,
  room: Room,
  threadId: string,
  privateReceipt: boolean
): Promise<void> => {
  const userId = mx.getUserId();
  const root = room.findEventById(threadId) ?? room.getThread(threadId)?.rootEvent;
  if (!userId || !isConfirmed(root)) return;
  const action = getThreadRootReadAction(mx, room, root);
  if (action === 'seen') {
    rememberSeenThreadRoot(userId, room.roomId, root, getMainTimelineReadTs(room, userId));
  } else if (action === 'receipt') {
    await markMainTimelineAsRead(mx, room.roomId, privateReceipt);
    // The receipt's local echo moved the read time past the roots seen before.
    forgetReadThreadRoots(userId, room.roomId, getMainTimelineReadTs(room, userId));
  }
};

/**
 * Reads one thread: its root (`markThreadRootAsRead`), then a receipt scoped to the thread on its
 * newest reply. Without the SDK's thread model, the server's latest reply is fetched. A reply the
 * user already read gets no new receipt, except the room's first thread receipt, which lets later
 * replies show as unread.
 */
export const markThreadAsRead = async (
  mx: MatrixClient,
  roomId: string,
  threadId: string,
  privateReceipt: boolean
): Promise<void> => {
  // A thread still being created has nothing the server could acknowledge.
  if (!isConfirmedMatrixEventId(threadId)) return;
  const room = mx.getRoom(roomId);
  if (!room) return;
  // The root first, so views that update on the thread receipt find the root read too.
  await markThreadRootAsRead(mx, room, threadId, privateReceipt);
  const thread = room.getThread(threadId);
  let target: MatrixEvent | undefined;
  if (thread) {
    target = latestThreadReply(thread);
    const userId = mx.getUserId() ?? undefined;
    const targetId = target?.getId();
    const alreadyRead =
      !!targetId && !!getThreadReadState(thread, userId)?.readEventIds.has(targetId);
    if (alreadyRead && !lacksThreadReceipt(room)) return;
  } else {
    target =
      (await fetchThreadTail(mx, roomId, threadId)) ??
      room
        .getLiveTimeline()
        .getEvents()
        .findLast((event) => isConfirmedReply(event) && event.threadRootId === threadId);
  }
  if (!target || !isConfirmed(target)) return;
  await send(mx.sendReceipt(target, receiptTypeFor(privateReceipt), { thread_id: threadId }));
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
  privateReceipt: boolean
): Promise<void> => {
  const room = mx.getRoom(roomId);
  if (!room) return;
  const target = latestRoomEvent(room);
  if (!target) return;
  await send(mx.sendReadReceipt(target, receiptTypeFor(privateReceipt), true));
};
