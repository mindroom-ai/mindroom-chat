import type { EventTimelineSet, MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { ownThreadId } from '../event-store/threads/threadFork';

/**
 * The parent thread of a row in a fork's prefix (`forkPrefixEventIds`), or undefined for the
 * fork's own rows. A parent's root copied from the cache may not know it starts a thread: its ID
 * names it.
 */
export const forkPrefixThreadId = (
  event: MatrixEvent,
  eventId: string,
  forkPrefixEventIds: ReadonlySet<string> | undefined
): string | undefined =>
  forkPrefixEventIds?.has(eventId) ? ownThreadId(event) ?? eventId : undefined;

/**
 * The room an event belongs to: for a cross-room fork prefix row, its owning room from the
 * client; otherwise `room`.
 */
export const rowEventRoom = (
  mx: Pick<MatrixClient, 'getRoom'>,
  room: Room,
  event: MatrixEvent,
  prefixThreadId: string | undefined
): Room => {
  if (!prefixThreadId) return room;
  const eventRoomId = event.getRoomId();
  if (!eventRoomId || eventRoomId === room.roomId) return room;
  return mx.getRoom(eventRoomId) ?? room;
};

/**
 * The set a row reads its edits from: a fork prefix's row its parent thread's (in `eventRoom`),
 * every other row its own (`rowTimelineSet`).
 */
export const rowEditTimelineSet = (
  eventRoom: Room,
  prefixThreadId: string | undefined,
  rowTimelineSet: EventTimelineSet
): EventTimelineSet =>
  (prefixThreadId ? eventRoom.getThread(prefixThreadId)?.getUnfilteredTimelineSet() : undefined) ??
  rowTimelineSet;
