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

const lastMatching = (
  events: readonly MatrixEvent[],
  predicate: (event: MatrixEvent) => boolean
): MatrixEvent | undefined => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return undefined;
};

const isConfirmedReply = (event: MatrixEvent): boolean =>
  isConfirmed(event) && isVisibleThreadReplyEvent(event);

/**
 * A thread's newest confirmed reply: the last loaded one or the reply the server's summary
 * names, whichever is newer. The summary wins a tie, since it is the server's view of the tail.
 */
const latestThreadReply = (thread: Thread): MatrixEvent | undefined => {
  const loaded = lastMatching(thread.events ?? [], isConfirmedReply);
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
  const target = lastMatching(
    room.getLiveTimeline().getEvents(),
    (event) => isConfirmed(event) && inMainTimelineForReceipt(event)
  );
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
 * Reads one thread: a receipt scoped to the thread on its newest reply. Without the SDK's thread
 * model, the server's latest reply is fetched. A reply the user already read gets no new receipt.
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
  const thread = room.getThread(threadId);
  let target: MatrixEvent | undefined;
  if (thread) {
    target = latestThreadReply(thread);
    const userId = mx.getUserId() ?? undefined;
    const targetId = target?.getId();
    if (targetId && getThreadReadState(thread, userId)?.readEventIds.has(targetId)) return;
  } else {
    target =
      (await fetchThreadTail(mx, roomId, threadId)) ??
      lastMatching(
        room.getLiveTimeline().getEvents(),
        (event) => isConfirmedReply(event) && event.threadRootId === threadId
      );
  }
  if (!target || !isConfirmed(target)) return;
  await send(mx.sendReceipt(target, receiptTypeFor(privateReceipt), { thread_id: threadId }));
};

const latestRoomEvent = (room: Room): MatrixEvent | undefined => {
  let latest = lastMatching(room.getLiveTimeline().getEvents(), isConfirmed);
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
