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

type VisibilityFlag = 'hideMembershipEvents' | 'hideNickAvatarEvents' | 'showHiddenEvents';

/**
 * The filters that turn raw timeline events into rendered rows. When present, ranges count
 * rendered rows rather than raw events.
 */
export type RecalibrateFilterOpts = Record<VisibilityFlag, boolean> & {
  room: Room;
  threadId: string | undefined;
  ignoredUsersSet: Set<string>;
  showThreadRepliesInRoom?: boolean;
};

export type InitialTimelineFilterOpts = Omit<RecalibrateFilterOpts, 'room'>;

export type RoomUnreadInfo = {
  readUptoEventId: string;
  inLiveTimeline: boolean;
  /** Jump to the read marker when the room opens. */
  scrollTo: boolean;
};

const unfilteredSet = (room: Room) => room.getUnfilteredTimelineSet();

/** The timeline sync appends to: the live end of the room's unfiltered set. */
export const getLiveTimeline = (room: Room): EventTimeline => unfilteredSet(room).getLiveTimeline();

/** The loaded timeline that holds `eventId`, if any. */
export const getEventTimeline = (room: Room, eventId: string): EventTimeline | undefined =>
  unfilteredSet(room).getTimelineForEvent(eventId) ?? undefined;

export const timelineToEventsCount = (timeline: EventTimeline): number =>
  timeline.getEvents().length;

export const getTimelinesEventsCount = (timelines: EventTimeline[]): number =>
  timelines.reduce((total, timeline) => total + timelineToEventsCount(timeline), 0);

/** Index of `eventId` within `eventTimeline`, counted across the whole linked chain. */
export const getEventIdAbsoluteIndex = (
  chain: EventTimeline[],
  holder: EventTimeline,
  eventId: string
): number | undefined => {
  const holderPosition = chain.indexOf(holder);
  if (holderPosition === -1) return undefined;
  const indexInHolder = holder.getEvents().findIndex((event) => event.getId() === eventId);
  if (indexInHolder === -1) return undefined;
  return getTimelinesEventsCount(chain.slice(0, holderPosition)) + indexInHolder;
};

/** Index of `eventId` across the linked chain, whichever timeline holds it. */
export const getLinkedTimelinesEventAbsoluteIndex = (
  chain: EventTimeline[],
  eventId: string
): number | undefined => {
  let offset = 0;
  for (const timeline of chain) {
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

/**
 * `range` once the row at `rowIndex` has left the rows it counts. The rows after that one move up
 * a place, so the window keeps every other row it held.
 */
export const getRangeWithoutRow = (range: TimelineRange, rowIndex: number): TimelineRange => {
  if (rowIndex >= range.end) return range;
  if (rowIndex < range.start) return { start: range.start - 1, end: range.end - 1 };
  return { start: range.start, end: range.end - 1 };
};

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
 * `filterOpts` is given) describe `chainBefore` before the pagination. A result for a chain
 * that is no longer the one on screen is dropped.
 */
export const recalibrateTimelinePagination = (
  setTimeline: Dispatch<SetStateAction<Timeline>>,
  chainBefore: EventTimeline[],
  timelinesEventsCount: number[],
  backwards: boolean,
  filterOpts?: RecalibrateFilterOpts,
  timelinesRenderableCounts?: number[]
): void => {
  const anchor = backwards ? chainBefore[0] : chainBefore[chainBefore.length - 1];
  if (!anchor) return;

  const previousCounts =
    filterOpts && timelinesRenderableCounts ? timelinesRenderableCounts : timelinesEventsCount;
  const rowFilter = filterOpts && timelinesRenderableCounts ? filterOpts : undefined;

  setTimeline((current) => {
    if (!sameTimelines(current.linkedTimelines, chainBefore)) return current;

    const nextLinkedTimelines = getLinkedTimelines(anchor);
    const rowsOf = (timeline: EventTimeline) => countRows([timeline], rowFilter);
    const previousCountOf = (timeline: EventTimeline) => {
      const index = chainBefore.indexOf(timeline);
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
 *
 * The SDK answers `getEventReadUpTo` only for an event it has loaded. A room the reader left
 * further back than the synced rows still has its receipt: it points at an event outside the
 * live timeline, which the New Messages line marks once a page loads it.
 */
export const getRoomUnreadInfo = (room: Room, scrollTo = false): RoomUnreadInfo | undefined => {
  const userId = room.myUserId ?? room.client?.getUserId?.();
  if (!userId) return undefined;
  const readUptoEventId =
    room.getEventReadUpTo(userId) ?? room.getReadReceiptForUserId?.(userId)?.eventId;
  if (!readUptoEventId) return undefined;
  const liveEvents = getLiveTimeline(room).getEvents();
  const latestEvent = liveEvents[liveEvents.length - 1];
  if (latestEvent?.getId() === readUptoEventId) return undefined;
  const inLiveTimeline = liveEvents.some((event) => event.getId() === readUptoEventId);
  return { readUptoEventId, inLiveTimeline, scrollTo };
};
