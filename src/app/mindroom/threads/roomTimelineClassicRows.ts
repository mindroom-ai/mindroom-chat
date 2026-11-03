import type { Room } from 'matrix-js-sdk';
import { getLinkedTimelines } from './linkedTimelines';
import { getRenderableEventEntries, type TimelineEventEntry } from './roomTimelineEvents';

type RowFilters = {
  ignoredUsersSet: Set<string>;
  readonly showHiddenEvents: boolean;
  readonly hideMembershipEvents: boolean;
  readonly hideNickAvatarEvents: boolean;
};

/**
 * The classic view reads like a plain chat: each thread's replies join the room's rows in time
 * order, although the client keeps them in the thread's own timeline. A reply carries its root's
 * position in the loaded timeline, which the unread divider compares against the read marker.
 */
export const buildClassicRoomRowEntries = (
  room: Room,
  roomEntries: TimelineEventEntry[],
  { ignoredUsersSet, showHiddenEvents, hideMembershipEvents, hideNickAvatarEvents }: RowFilters
): TimelineEventEntry[] => {
  const known = new Set(roomEntries.map(({ event }) => event.getId()));
  const rootPositions = new Map(
    roomEntries.map(({ event, absoluteIndex }) => [event.getId(), absoluteIndex])
  );
  const replies: TimelineEventEntry[] = [];
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
      replies.push({ event, absoluteIndex: rootPositions.get(thread.id) ?? roomEntries.length });
    });
  });
  if (replies.length === 0) return roomEntries;
  return [...roomEntries, ...replies].sort(
    (a, b) =>
      a.event.getTs() - b.event.getTs() || (a.event.getId() ?? '').localeCompare(b.event.getId() ?? '')
  );
};
