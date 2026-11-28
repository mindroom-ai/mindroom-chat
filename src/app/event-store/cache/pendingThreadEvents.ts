import { type MatrixEvent, RelationType, type Room } from 'matrix-js-sdk';
import {
  isFailedLocalEchoEvent,
  isPendingLocalEchoEvent,
} from '../../matrix/protocol/pendingLocalEcho';

// Chronological SDK rooms keep unsent thread replies outside their timelines.
// Retain the original SDK objects so status changes, retry, and cancellation
// keep working after the thread view unmounts.
const pendingByRoom = new WeakMap<Room, Set<MatrixEvent>>();

export const trackPendingThreadEvent = (event: MatrixEvent, room: Room): void => {
  const pending = pendingByRoom.get(room);
  if (!isPendingLocalEchoEvent(event) && !isFailedLocalEchoEvent(event)) {
    pending?.delete(event);
    return;
  }
  if (event.getRelation()?.rel_type !== RelationType.Thread) return;
  if (pending) pending.add(event);
  else pendingByRoom.set(room, new Set([event]));
};

const EMPTY_PENDING_EVENTS: MatrixEvent[] = [];

const isActivePendingEvent = (event: MatrixEvent): boolean =>
  isPendingLocalEchoEvent(event) || isFailedLocalEchoEvent(event);

export const getPendingThreadEventsByThread = (
  room: Room
): ReadonlyMap<string, MatrixEvent[]> | undefined => {
  const pending = pendingByRoom.get(room);
  if (!pending || pending.size === 0) return undefined;
  let grouped: Map<string, MatrixEvent[]> | undefined;
  for (const event of pending) {
    if (!isActivePendingEvent(event)) continue;
    const threadId = event.getRelation()?.event_id;
    if (!threadId) continue;
    grouped ??= new Map();
    const list = grouped.get(threadId);
    if (list) list.push(event);
    else grouped.set(threadId, [event]);
  }
  return grouped;
};

export const getPendingThreadEvents = (room: Room, threadId: string): MatrixEvent[] => {
  const pending = pendingByRoom.get(room);
  if (!pending || pending.size === 0) return EMPTY_PENDING_EVENTS;
  const matching: MatrixEvent[] = [];
  for (const event of pending) {
    if (isActivePendingEvent(event) && event.getRelation()?.event_id === threadId) {
      matching.push(event);
    }
  }
  return matching.length > 0 ? matching : EMPTY_PENDING_EVENTS;
};
