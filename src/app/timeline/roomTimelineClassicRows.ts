import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { getLinkedTimelines } from '../event-store/timeline/linkedTimelines';
import { getRenderableEventEntries, type TimelineEventEntry } from '../event-store/timeline/roomTimelineEvents';

type RowFilters = {
  ignoredUsersSet: Set<string>;
  readonly showHiddenEvents: boolean;
  readonly hideMembershipEvents: boolean;
  readonly hideNickAvatarEvents: boolean;
};

/** Sent time, then event ID, so replies of the same moment keep one order. */
const sentBefore = (a: MatrixEvent, b: MatrixEvent): boolean => {
  const byTime = a.getTs() - b.getTs();
  return byTime === 0 ? (a.getId() ?? '') < (b.getId() ?? '') : byTime < 0;
};

/**
 * The classic view reads like a plain chat: each thread's replies join the room's rows by the
 * time they were sent, although the client keeps them in the thread's own timeline. The room
 * rows stay in timeline order, whatever their clocks say. A reply's position lies between those
 * of the rows around it, so the unread divider, which compares positions with the read marker,
 * treats it like a room row sent at the same moment.
 */
export const buildClassicRoomRowEntries = (
  room: Room,
  roomEntries: TimelineEventEntry[],
  { ignoredUsersSet, showHiddenEvents, hideMembershipEvents, hideNickAvatarEvents }: RowFilters
): TimelineEventEntry[] => {
  const known = new Set(roomEntries.map(({ event }) => event.getId()));
  const replies: MatrixEvent[] = [];
  (room.getThreads?.() ?? []).forEach((thread) => {
    const threadTimeline = thread.liveTimeline;
    if (!threadTimeline) return;
    const threadEntries = getRenderableEventEntries(
      getLinkedTimelines(threadTimeline),
      room,
      undefined,
      ignoredUsersSet,
      showHiddenEvents,
      hideMembershipEvents,
      hideNickAvatarEvents,
      true
    );
    threadEntries.forEach(({ event }) => {
      const id = event.getId();
      if (!id || id === thread.id || known.has(id)) return;
      known.add(id);
      replies.push(event);
    });
  });
  if (replies.length === 0) return roomEntries;
  replies.sort((a, b) => (sentBefore(a, b) ? -1 : 1));

  const merged: TimelineEventEntry[] = [];
  let next = 0;
  // The replies sent before `row`, at positions after the row above it (or just before `row`).
  const placeRepliesBefore = (row: TimelineEventEntry | undefined, above: number) => {
    const start = next;
    const due = (reply: MatrixEvent | undefined) =>
      reply !== undefined && (!row || sentBefore(reply, row.event));
    while (due(replies[next])) next += 1;
    const count = next - start;
    replies.slice(start, next).forEach((event, offset) => {
      merged.push({ event, absoluteIndex: above + (offset + 1) / (count + 1) });
    });
  };
  roomEntries.forEach((row, index) => {
    placeRepliesBefore(row, roomEntries[index - 1]?.absoluteIndex ?? row.absoluteIndex - 1);
    merged.push(row);
  });
  const lastRow = roomEntries[roomEntries.length - 1];
  placeRepliesBefore(undefined, lastRow ? lastRow.absoluteIndex : -1);
  return merged;
};
