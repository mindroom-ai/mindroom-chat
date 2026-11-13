import { useCallback, useMemo, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { Direction, type EventTimeline, type MatrixClient, type Room } from 'matrix-js-sdk';
import { useAlive } from '../lib/hooks/useAlive';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { decryptAllTimelineEvent } from '../matrix/room';
import { getRenderableEvents } from '../event-store/timeline/roomTimelineEvents';
import { paginateRoomHistory } from '../event-store/sdk/roomHistoryPageSdk';
import {
  getEventIdAbsoluteIndex,
  getTimelinesEventsCount,
  recalibrateTimelinePagination,
  timelineToEventsCount,
  type RecalibrateFilterOpts,
  type Timeline,
} from '../event-store/timeline/timelinePagination';
import { getLinkedTimelines } from '../event-store/timeline/linkedTimelines';
import { ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE } from '../event-store/cache/preloadSettings';

// How the room view (not a thread) brings in history it does not hold yet: the timeline around
// one event, for a jump to a row that is not loaded, and one page at the older or newer end of the
// chain it shows. Whether an event makes a row depends on its decrypted type (a decrypted reaction
// or edit makes none), so what arrives is decrypted before any rows are counted.

/** Decrypts the events of `timeline`. An event that fails stays as it is; nothing is thrown. */
const decryptQuietly = async (mx: MatrixClient, timeline: EventTimeline): Promise<void> => {
  try {
    await decryptAllTimelineEvent(mx, timeline);
  } catch {
    // The row of an event that cannot be decrypted shows the failure; the load goes on.
  }
};

/** The timeline the server returns around `eventId`; undefined when it has none or fails. */
const fetchEventContext = async (
  mx: MatrixClient,
  room: Room,
  eventId: string
): Promise<EventTimeline | undefined> => {
  try {
    return (await mx.getEventTimeline(room.getUnfilteredTimelineSet(), eventId)) ?? undefined;
  } catch {
    return undefined;
  }
};

/**
 * A loader for the room's history around one event. Each load ends in one call: `onLoad` with the
 * chain linked to the returned timeline (oldest first) and the event's index across that chain,
 * or `onError` when the request fails, returns nothing, or returns a timeline without the event.
 * An event the server sends alone comes with a page of history on each side (`loadRowsAround`),
 * so the jump has rows to land among.
 * The handlers of the newest render answer, while it shows the load's room: a load for a room the
 * view has left ends without an answer. Loads are neither merged nor cancelled, and the loader
 * does not check that its component is still mounted: the handlers do.
 */
export const useEventTimelineLoader = (
  mx: MatrixClient,
  room: Room,
  onLoad: (eventId: string, linkedTimelines: EventTimeline[], absoluteIndex: number) => void,
  onError: () => void,
  filterOptsRef: RefObject<RecalibrateFilterOpts | undefined>
): ((eventId: string) => Promise<void>) => {
  const handlersRef = useLatestRef({ onLoad, onError });
  // The handlers answer for the room on screen: a load for a room the view has left is dropped.
  const roomRef = useLatestRef(room);

  return useCallback(
    async (eventId: string): Promise<void> => {
      const holder = await fetchEventContext(mx, room, eventId);
      // The caller counts rows in what it gets, so the returned timeline is decrypted first.
      if (holder && room.hasEncryptionStateEvent()) await decryptQuietly(mx, holder);
      if (roomRef.current !== room) return;
      if (!holder) {
        handlersRef.current.onError();
        return;
      }
      const filterOpts = filterOptsRef.current;
      if (filterOpts) await loadRowsAround(mx, room, holder, filterOpts);
      if (roomRef.current !== room) return;
      const chain = getLinkedTimelines(holder);
      const absoluteIndex = getEventIdAbsoluteIndex(chain, holder, eventId);
      if (absoluteIndex === undefined) {
        handlersRef.current.onError();
        return;
      }
      handlersRef.current.onLoad(eventId, chain, absoluteIndex);
    },
    [filterOptsRef, handlersRef, mx, room, roomRef]
  );
};

/** The chain on screen when a page starts, and what each of its timelines held then. */
type PageStart = {
  chain: EventTimeline[];
  /** Raw events per timeline of `chain`. */
  eventCounts: number[];
  filterOpts: RecalibrateFilterOpts | undefined;
  /** Rows per timeline of `chain` under `filterOpts`, when there are filters. */
  rowCounts: number[] | undefined;
};

/** Rows `timeline` renders on its own: the count the window update takes after the page. */
const countTimelineRows = (timeline: EventTimeline, opts: RecalibrateFilterOpts): number =>
  getRenderableEvents(
    [timeline],
    opts.room,
    opts.threadId,
    opts.ignoredUsersSet,
    opts.showHiddenEvents,
    opts.hideMembershipEvents,
    opts.hideNickAvatarEvents,
    opts.showThreadRepliesInRoom
  ).length;

const recordPageStart = (
  chain: EventTimeline[],
  filterOpts: RecalibrateFilterOpts | undefined
): PageStart => ({
  chain,
  eventCounts: chain.map(timelineToEventsCount),
  filterOpts,
  // With every filter the window update applies, thread replies shown in the room included:
  // a row the chain already held must not count as added.
  rowCounts: filterOpts
    ? chain.map((timeline) => countTimelineRows(timeline, filterOpts))
    : undefined,
});

/** The timelines a page at `edge` may have filled: the edge and every timeline beyond it. */
const timelinesFrom = (
  chain: EventTimeline[],
  edge: EventTimeline,
  backwards: boolean
): EventTimeline[] => {
  const position = chain.indexOf(edge);
  if (position === -1) return [edge];
  return backwards ? chain.slice(0, position + 1) : chain.slice(position);
};

/**
 * Asks the server for one page at `edge`. A page of the room's own history goes through
 * `paginateRoomHistory`, and the Classic view (`opts` showing thread replies in the room) keeps the
 * page's thread replies, which the SDK drops. False when the request failed.
 */
const requestPage = async (
  mx: MatrixClient,
  edge: EventTimeline,
  backwards: boolean,
  limit: number,
  opts: RecalibrateFilterOpts | undefined
): Promise<boolean> => {
  try {
    if (opts && !opts.threadId) {
      await paginateRoomHistory(
        mx,
        opts.room,
        edge,
        backwards,
        limit,
        !!opts.showThreadRepliesInRoom
      );
    } else {
      await mx.paginateEventTimeline(edge, { backwards, limit });
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * The server sends the event alone (the SDK asks `/context` for no neighbours). An event that
 * makes no row of its own (the room's creation, a reaction, a hidden membership change) leaves a
 * jump nothing to land on, and a row alone leaves it no room to aim: the row sits where a lone
 * row sits, at the bottom of the view, the jump ends there, and the rows that load around it
 * afterwards keep it there, so what follows it (the New Messages line under a read marker) stays
 * out of view. A page of the room's previous rows that is still out can also land meanwhile and
 * link the event's timeline to the live one behind a window that shows the event alone. So when
 * the chain around `holder` holds at most one row under `opts`, one page of history loads on each
 * side of it before the jump, decrypted in an encrypted room.
 */
const loadRowsAround = async (
  mx: MatrixClient,
  room: Room,
  holder: EventTimeline,
  opts: RecalibrateFilterOpts
): Promise<void> => {
  const chain = getLinkedTimelines(holder);
  const rows = chain.reduce((total, timeline) => total + countTimelineRows(timeline, opts), 0);
  if (rows > 1) return;
  const ends = [
    { edge: chain[0], backwards: true },
    { edge: chain[chain.length - 1], backwards: false },
  ];
  await Promise.all(
    ends.map(({ edge, backwards }) =>
      edge?.getPaginationToken(backwards ? Direction.Backward : Direction.Forward)
        ? requestPage(mx, edge, backwards, ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE, opts)
        : false
    )
  );
  if (!room.hasEncryptionStateEvent()) return;
  await Promise.all(getLinkedTimelines(holder).map((timeline) => decryptQuietly(mx, timeline)));
};

/**
 * The room view's pager: `true` loads older history at the start of the chain on screen, `false`
 * newer history at its end, and the mounted window moves so the rows on screen keep their place.
 * It works on the state of the newest render. One page is out at a time: a call made meanwhile
 * does nothing. Failures leave the window as it is; the promise never rejects for them.
 */
export const useTimelinePagination = (
  mx: MatrixClient,
  timeline: Readonly<Timeline>,
  setTimeline: Dispatch<SetStateAction<Timeline>>,
  limit: number,
  filterOptsRef: RefObject<RecalibrateFilterOpts | undefined>
): ((backwards: boolean) => Promise<void>) => {
  const alive = useAlive();
  const timelineRef = useLatestRef(timeline);

  return useMemo(() => {
    // Each pager has its own: a new client, setter, limit or filter ref starts with none out.
    let pageInFlight = false;

    return async (backwards: boolean): Promise<void> => {
      if (pageInFlight) return;
      const start = recordPageStart(
        timelineRef.current.linkedTimelines,
        filterOptsRef.current ?? undefined
      );
      const edge = backwards ? start.chain[0] : start.chain[start.chain.length - 1];
      if (!edge) return;
      const moveWindow = () =>
        recalibrateTimelinePagination(
          setTimeline,
          start.chain,
          start.eventCounts,
          backwards,
          start.filterOpts,
          start.rowCounts
        );

      if (!edge.getPaginationToken(backwards ? Direction.Backward : Direction.Forward)) {
        // The room's start or its live end. Timelines the SDK has linked on since the window
        // was set join it now.
        if (getLinkedTimelines(edge).length !== start.chain.length) moveWindow();
        return;
      }

      pageInFlight = true;
      try {
        const eventsBefore = getTimelinesEventsCount(getLinkedTimelines(edge));
        const answered = await requestPage(mx, edge, backwards, limit, start.filterOpts);
        if (!answered || !alive()) return;
        const chainAfter = getLinkedTimelines(edge);
        // A page without events (it only moved or cleared the token) leaves the window.
        if (getTimelinesEventsCount(chainAfter) === eventsBefore) return;
        await Promise.all(
          timelinesFrom(chainAfter, edge, backwards).map((filled) => decryptQuietly(mx, filled))
        );
        if (alive()) moveWindow();
      } finally {
        pageInFlight = false;
      }
    };
  }, [alive, filterOptsRef, limit, mx, setTimeline, timelineRef]);
};
