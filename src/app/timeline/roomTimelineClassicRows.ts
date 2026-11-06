import type { EventTimeline, MatrixEvent, Room } from 'matrix-js-sdk';
import { getLinkedTimelines } from '../event-store/timeline/linkedTimelines';
import {
  getRenderableEventEntries,
  type TimelineEventEntry,
} from '../event-store/timeline/roomTimelineEvents';
import type { Timeline, TimelineRange } from '../event-store/timeline/timelinePagination';

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
 * The classic view reads like a plain chat: thread replies join the room's rows by the time they
 * were sent, although the client keeps them apart from the room's timeline: the replies each
 * thread holds, and `historyReplies`, those the room's history pages brought
 * (classicHistoryReplies); a reply both hold shows once, as its thread holds it. Replies sent
 * before `historyStart`, the first event of the history the room holds, wait for the page that
 * brings their part of the room. The room rows stay in timeline order, whatever their clocks say.
 * A reply's position lies between those of the rows around it, so the unread divider, which
 * compares positions with the read marker, treats it like a room row sent at the same moment.
 */
export const buildClassicRoomRowEntries = (
  room: Room,
  roomEntries: TimelineEventEntry[],
  historyReplies: MatrixEvent[],
  { ignoredUsersSet, showHiddenEvents, hideMembershipEvents, hideNickAvatarEvents }: RowFilters,
  historyStart?: MatrixEvent
): TimelineEventEntry[] => {
  const known = new Set(roomEntries.map(({ event }) => event.getId()));
  const replies: MatrixEvent[] = [];
  const inHistory = (event: MatrixEvent) => !historyStart || !sentBefore(event, historyStart);
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
      if (!id || id === thread.id || known.has(id) || !inHistory(event)) return;
      known.add(id);
      replies.push(event);
    });
  });
  historyReplies.forEach((event) => {
    const id = event.getId();
    if (!id || known.has(id) || !inHistory(event)) return;
    known.add(id);
    replies.push(event);
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

/** The classic window as the last commit placed it, and the state it came from. */
export type ClassicWindow = {
  source: TimelineRange;
  chain: EventTimeline[];
  range: TimelineRange;
  firstRowId?: string;
};

const sameRange = (a: TimelineRange, b: TimelineRange) => a.start === b.start && a.end === b.end;

/**
 * Windows that count the room timeline's rows, not the classic view's (`getInitialTimeline`): the
 * window a room opens with, at its newest row.
 */
const roomRowWindows = new WeakSet<Timeline>();

/** Marks `timeline` as a window over the room timeline's rows (see `placeClassicWindow`). */
export const countsRoomRows = (timeline: Timeline): Timeline => {
  roomRowWindows.add(timeline);
  return timeline;
};

/**
 * Where the classic view's window lies over its rows. Its rows are more than the room timeline's:
 * thread replies join them from outside it, so counting the room timeline's rows cannot say how
 * far rows that joined above the window moved it. The window follows its first row instead: a
 * window nobody moved since the last commit (`source` unchanged) keeps it, and one set since, over
 * the same history or more of it, was set over the rows of the last commit and moves with it. So
 * rows that join above the reader, such as a page of history with its replies, move the window
 * down by as many rows, and the rows the reader sees stay mounted where they were, also when a
 * pager set the window in the same render. A window over other history, or one that counts the
 * room timeline's rows (`countsRoomRows`), is taken as it is; the latter ending at its newest row
 * (`roomRowCount`) ends at the newest row.
 */
export const placeClassicWindow = (
  previous: ClassicWindow | undefined,
  timeline: Timeline,
  rows: TimelineEventEntry[],
  roomRowCount: number
): TimelineRange => {
  const { range: source, linkedTimelines } = timeline;
  const unmoved = previous && (source === previous.range || sameRange(source, previous.source));
  const sameHistory = previous?.chain.every((part) => linkedTimelines.includes(part));
  if (previous && !roomRowWindows.has(timeline) && (unmoved || sameHistory)) {
    const range = unmoved ? previous.range : source;
    const { firstRowId } = previous;
    const first = firstRowId ? rows.findIndex(({ event }) => event.getId() === firstRowId) : -1;
    const shift = first === -1 ? 0 : first - previous.range.start;
    return shift === 0 ? range : { start: range.start + shift, end: range.end + shift };
  }
  if (rows.length === roomRowCount || source.end !== roomRowCount) return source;
  const size = source.end - source.start;
  return { start: Math.max(rows.length - size, 0), end: rows.length };
};
