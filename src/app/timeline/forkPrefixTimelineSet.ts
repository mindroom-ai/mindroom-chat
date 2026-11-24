import type { EventTimelineSet, MatrixEvent, Room } from 'matrix-js-sdk';
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
 * The set a row reads its edits from: a fork prefix's row its parent thread's, every other row
 * its own (`rowTimelineSet`).
 */
export const rowEditTimelineSet = (
  room: Room,
  prefixThreadId: string | undefined,
  rowTimelineSet: EventTimelineSet
): EventTimelineSet =>
  (prefixThreadId ? room.getThread(prefixThreadId)?.getUnfilteredTimelineSet() : undefined) ??
  rowTimelineSet;
