import type { Dispatch, SetStateAction } from 'react';
import type { EventTimeline, MatrixEvent, Room } from 'matrix-js-sdk';
import { getFirstLinkedTimeline, getLinkedTimelines } from './linkedTimelines';
import { getRenderableEvents } from './roomTimelineEvents';

export { getFirstLinkedTimeline, getLinkedTimelines };

/** Half-open window `[start, end)` of rendered rows. */
export type TimelineRange = {
  start: number;
  end: number;
};

/** The linked chain the room view renders from, and the window of it that is mounted. */
export type Timeline = {
  linkedTimelines: EventTimeline[];
  range: TimelineRange;
};

/**
 * The filters that turn raw timeline events into rendered rows. When present, ranges count
 * rendered rows rather than raw events.
 */
export type RecalibrateFilterOpts = {
  room: Room;
  threadId: string | undefined;
  ignoredUsersSet: Set<string>;



  showThreadRepliesInRoom?: boolean;
};

export type InitialTimelineFilterOpts = Omit<RecalibrateFilterOpts, 'room'>;

export type RoomUnreadInfo = {
  readUptoEventId: string;
  inLiveTimeline: boolean;







  room.getUnfilteredTimelineSet().getTimelineForEvent(eventId) ?? undefined;

export const timelineToEventsCount = (timeline: EventTimeline): number =>
  timeline.getEvents().length;

export const getTimelinesEventsCount = (timelines: EventTimeline[]): number =>
  timelines.reduce((total, timeline) => total + timelineToEventsCount(timeline), 0);

/** Index of `eventId` within `eventTimeline`, counted across the whole linked chain. */





  const timelineIndex = linkedTimelines.indexOf(eventTimeline);
  if (timelineIndex === -1) return undefined;
  const indexInTimeline = eventTimeline.getEvents().findIndex((event) => event.getId() === eventId);
  if (indexInTimeline === -1) return undefined;
  return getTimelinesEventsCount(linkedTimelines.slice(0, timelineIndex)) + indexInTimeline;
};

/** Index of `eventId` across the linked chain, whichever timeline holds it. */
export const getLinkedTimelinesEventAbsoluteIndex = (



  let offset = 0;
  for (const timeline of linkedTimelines) {
    const events = timeline.getEvents();
    const index = events.findIndex((event) => event.getId() === eventId);
    if (index !== -1) return offset + index;
    offset += events.length;
  }
  return undefined;
};

/** The newest `limit` rows of `count`. */
export const getLatestTimelineRange = (count: number, limit: number): TimelineRange => ({
  start: Math.max(count - limit, 0),
  end: count,
});

/** Keep `range` when it is a non-empty window inside `count`; otherwise fall back to the latest rows. */
export const getVisibleTimelineRange = (
  range: TimelineRange,
  count: number,
  limit: number
): TimelineRange => {
  if (count <= 0) return { start: 0, end: 0 };
  const valid = range.start >= 0 && range.start < range.end && range.end <= count;
  return valid ? range : getLatestTimelineRange(count, limit);
};

/**
 * The window the room view mounts. A thread renders from its own list, so the room range is
 * empty; a filtered room overview mounts every matching row; otherwise the paginated window.
 */
export const getActiveTimelineRange = (
  threadId: string | undefined,
  filteredRoomThreadActive: boolean,
  range: TimelineRange,
  count: number,
  limit: number
): TimelineRange => {
  if (threadId) return { start: 0, end: 0 };
  if (filteredRoomThreadActive) return { start: 0, end: count };
  return getVisibleTimelineRange(range, count, limit);
};

/** Position of the focused event in the rendered room order, or `fallbackIndex`. */
export const getFocusedRoomEventIndex = (
  events: MatrixEvent[],
  eventId: string | undefined,
  fallbackIndex: number
): number => {
  if (!eventId) return fallbackIndex;
  const index = events.findIndex((event) => event.getId() === eventId);
  return index === -1 ? fallbackIndex : index;
};

export const getEmptyTimeline = (): Timeline => ({
  linkedTimelines: [],
  range: { start: 0, end: 0 },
});

const countRows = (timelines: EventTimeline[], filterOpts?: RecalibrateFilterOpts): number =>
  filterOpts
    ? getRenderableEvents(
        timelines,
        filterOpts.room,
        filterOpts.threadId,
        filterOpts.ignoredUsersSet,
        filterOpts.showHiddenEvents,
        filterOpts.hideMembershipEvents,
        filterOpts.hideNickAvatarEvents,
        filterOpts.showThreadRepliesInRoom
      ).length
    : getTimelinesEventsCount(timelines);

/** The live chain of the room with its newest `limit` rows mounted. */
export const getInitialTimeline = (
  room: Room,
  limit: number,
  filterOpts?: InitialTimelineFilterOpts
): Timeline => {
  const linkedTimelines = getLinkedTimelines(getLiveTimeline(room));
  const count = countRows(linkedTimelines, filterOpts ? { ...filterOpts, room } : undefined);
  return {
    linkedTimelines,
    range: getLatestTimelineRange(count, limit),
  };
};

const sameTimelines = (a: EventTimeline[], b: EventTimeline[]): boolean =>
  a === b || (a.length === b.length && a.every((timeline, index) => timeline === b[index]));

/**
 * Rebuild the linked chain after a pagination grew it, and move the mounted window so the rows
 * already on screen keep their place: backward pagination prepends rows, so the window shifts by
 * the number of rows added; forward pagination appends after it and leaves it in place.
 *
 * `timelinesEventsCount` (raw events) and `timelinesRenderableCounts` (rendered rows, when
 * `filterOpts` is given) describe `linkedTimelines` before the pagination. A result for a chain
 * that is no longer the one on screen is dropped.
 */
export const recalibrateTimelinePagination = (



  backwards: boolean,
  filterOpts?: RecalibrateFilterOpts,
  timelinesRenderableCounts?: number[]
): void => {
  const anchor = backwards ? linkedTimelines[0] : linkedTimelines[linkedTimelines.length - 1];
  if (!anchor) return;

  const previousCounts =
    filterOpts && timelinesRenderableCounts ? timelinesRenderableCounts : timelinesEventsCount;
  const rowFilter = filterOpts && timelinesRenderableCounts ? filterOpts : undefined;

  setTimeline((current) => {
    if (!sameTimelines(current.linkedTimelines, linkedTimelines)) return current;

    const nextLinkedTimelines = getLinkedTimelines(anchor);
    const rowsOf = (timeline: EventTimeline) => countRows([timeline], rowFilter);
    const previousCountOf = (timeline: EventTimeline) => {
      const index = linkedTimelines.indexOf(timeline);
      return index === -1 ? 0 : previousCounts[index] ?? 0;
    };

    // Rows added on the anchor's side: the anchor itself and everything beyond it.
    const anchorIndex = nextLinkedTimelines.indexOf(anchor);
    const grown =
      anchorIndex === -1
        ? []
        : backwards
        ? nextLinkedTimelines.slice(0, anchorIndex + 1)
        : nextLinkedTimelines.slice(anchorIndex);
    const added = grown.reduce(
      (total, timeline) => total + Math.max(rowsOf(timeline) - previousCountOf(timeline), 0),
      0
    );
    // Rows added before the window shift it; rows added after it leave it in place.
    const shift = backwards ? added : 0;
    return {
      linkedTimelines: nextLinkedTimelines,
      range: { start: current.range.start + shift, end: current.range.end + shift },
    };
  });
};

/**
 * Where the reader's read marker sits in the room, or undefined when there is nothing unread to
 * point at (no receipt yet, or the receipt is on the newest event).
 */
export const getRoomUnreadInfo = (room: Room, scrollTo = false): RoomUnreadInfo | undefined => {
  const userId = room.myUserId ?? room.client?.getUserId?.();
  if (!userId) return undefined;
  const readUptoEventId = room.getEventReadUpTo(userId);
  if (!readUptoEventId) return undefined;
  const liveEvents = getLiveTimeline(room).getEvents();
  const latestEvent = liveEvents[liveEvents.length - 1];
  if (latestEvent?.getId() === readUptoEventId) return undefined;
  const inLiveTimeline = liveEvents.some((event) => event.getId() === readUptoEventId);
  return { readUptoEventId, inLiveTimeline, scrollTo };
};
