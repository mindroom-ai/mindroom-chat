import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import {
  Direction,
  ThreadEvent,
  type EventTimeline,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import type { Virtualizer } from '@tanstack/react-virtual';
import { useVirtualPaginator, type ItemRange } from './useVirtualPaginator';
import { useLiveEventRemove } from '../event-store/timeline/roomLiveEventArrive';
import {
  getRangeWithoutRow,
  type RecalibrateFilterOpts,
  type Timeline,
} from '../event-store/timeline/timelinePagination';
import { getRenderableEvents } from '../event-store/timeline/roomTimelineEvents';
import { getLinkedTimelines } from '../event-store/timeline/linkedTimelines';
import { shouldAutoPaginateThreadBack } from '../event-store/threads/threadRenderUtils';
import { countCacheProbe } from '../event-store/cache/cacheProbe';
import {
  ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE,
  THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS,
} from '../event-store/cache/preloadSettings';
import { useLatestRef } from '../lib/hooks/useLatestRef';

/**
 * The window of room rows the timeline mounts and how it moves: widened and paged by the reader's
 * scrolling, kept at the newest row, and closed up when a row leaves the room's timeline. A
 * thread's older rows page in as the reader nears its top.
 */

type SetTimeline = Dispatch<SetStateAction<Timeline>>;

/**
 * A window that reached the newest row keeps reaching it when rows join without a live event,
 * such as thread replies the classic view merges in or restored history.
 */
export const useWindowKeepsNewestRow = ({
  activeTimelineRange,
  eventId,
  roomRowCount,
  threadId,
  setTimeline,
}: {
  activeTimelineRange: ItemRange;
  eventId: string | undefined;
  roomRowCount: number;
  threadId: string | undefined;
  setTimeline: SetTimeline;
}) => {
  const windowEndRef = useRef<{ end: number; count: number }>(undefined);
  useLayoutEffect(() => {
    const { start, end } = activeTimelineRange;
    const previous = windowEndRef.current;
    windowEndRef.current = { end, count: roomRowCount };
    const reachedEnd = previous ? previous.end >= previous.count : !eventId;
    if (threadId || !reachedEnd || end >= roomRowCount) return;
    if (previous && end < previous.count) return;
    setTimeline((current) => ({ ...current, range: { start, end: roomRowCount } }));
  }, [activeTimelineRange, eventId, roomRowCount, setTimeline, threadId]);
};

/**
 * The room's rows list a closed fold as one row (`RoomRowProjection`), and a window that the
 * state counts into a closed fold shows the fold whole: a page of history brought earlier events
 * of the run the window starts with, or a fold closed over a window's edge. The state then
 * follows the window shown, so what counts on from it (a live row grown in at its end) counts
 * from the rows on screen, and a fold that opens has its rows in the window.
 *
 * The window shown is the state's, or the newest rows where the state's no longer fits the rows
 * (`getVisibleTimelineRange`: a row left the room's rows): the state follows from either.
 */
export const useWindowHoldsWholeFolds = ({
  timeline,
  roomWindow,
  stateRange,
  loadedRange,
  setTimeline,
}: {
  timeline: Timeline;
  /** The room's own window is shown: not a thread's rows, nor a filtered overview's. */
  roomWindow: boolean;
  /** The window the state counts, in loaded rows, and the loaded rows of the window shown. */
  stateRange: ItemRange;
  loadedRange: ItemRange;
  setTimeline: SetTimeline;
}) => {
  useLayoutEffect(() => {
    // The window shown is the state's own object while it holds the same rows.
    if (!roomWindow || loadedRange === stateRange) return;
    // Unless the state moved meanwhile (the classic view placed its window): it shows next.
    const stored = timeline.range;
    setTimeline((current) =>
      current.range === stored ? { ...current, range: loadedRange } : current
    );
  }, [loadedRange, roomWindow, setTimeline, stateRange, timeline.range]);
};

/**
 * Shows the chain a limited sync's relink rebuilt, unless it holds no row: a server can mark a
 * room's timeline limited for events the view hides (a member's new name while membership changes
 * are hidden), and the new live timeline alone then shows nothing. The view keeps its rows while
 * one page of history links the new live timeline to them, then shows the chain rebuilt again.
 */
export const useRelinkKeepingRows = ({
  alive,
  mx,
  filterOptsRef,
  rebuildTimeline,
  setTimeline,
}: {
  alive: () => boolean;
  mx: MatrixClient;
  filterOptsRef: MutableRefObject<RecalibrateFilterOpts>;
  rebuildTimeline: () => Timeline;
  setTimeline: SetTimeline;
}): SetTimeline =>
  useCallback(
    (next) => {
      const first = typeof next === 'function' ? undefined : next.linkedTimelines[0];
      if (typeof next === 'function' || !first?.getPaginationToken(Direction.Backward)) {
        setTimeline(next);
        return;
      }
      const { room, ...filters } = filterOptsRef.current;
      const rows = getRenderableEvents(
        next.linkedTimelines,
        room,
        undefined,
        filters.ignoredUsersSet,
        filters.showHiddenEvents,
        filters.hideMembershipEvents,
        filters.hideNickAvatarEvents,
        filters.showThreadRepliesInRoom
      );
      if (rows.length > 0) {
        setTimeline(next);
        return;
      }
      void mx
        .paginateEventTimeline(first, {
          backwards: true,
          limit: ROOM_TIMELINE_INTERACTIVE_BATCH_SIZE,
        })
        .catch(() => false)
        .then(() => {
          if (alive()) setTimeline(rebuildTimeline());
        });
    },
    [alive, filterOptsRef, mx, rebuildTimeline, setTimeline]
  );

/**
 * Calls `onDeleted` when one of the room's threads goes away while the room (not a thread) is
 * shown. The SDK edits the room's timeline in place for it, without a timeline event: it takes
 * the thread off the root and its replies, and a root may leave the timeline with it.
 */
export const useRoomThreadDeleted = (
  room: Room,
  threadId: string | undefined,
  onDeleted: () => void
) => {
  useEffect(() => {
    if (threadId) return undefined;
    room.on(ThreadEvent.Delete, onDeleted);
    return () => {
      room.removeListener(ThreadEvent.Delete, onDeleted);
    };
  }, [room, threadId, onDeleted]);
};

/**
 * Takes a row that left the room's timeline (a cancelled send, say) out of the window, which
 * keeps every other row it held: the rows after it move up a place, and a window that reached the
 * newest row still ends there. Thread views keep their own rows.
 *
 * A back page in flight counted the rows before it started and sets its window when it lands,
 * which leaves the removed row out. The removal waits for it, so the window is not drawn again
 * over the page's new rows with the range from before the page.
 */
export const useRoomRowRemoval = ({
  room,
  timelineRef,
  roomRowsRef,
  activeRangeRef,
  windowFollowsRowsRef,
  paginatingBackRef,
  threadIdRef,
  setTimeline,
}: {
  room: Room;
  timelineRef: MutableRefObject<Timeline>;
  roomRowsRef: MutableRefObject<MatrixEvent[]>;
  activeRangeRef: MutableRefObject<Timeline['range']>;
  /** False while the filtered overview mounts every row, whatever the window. */
  windowFollowsRowsRef: MutableRefObject<boolean>;
  paginatingBackRef: MutableRefObject<boolean>;
  threadIdRef: MutableRefObject<string | undefined>;
  setTimeline: SetTimeline;
}) => {
  const handleRemove = useCallback(
    (mEvent: MatrixEvent, removedFrom: EventTimeline | undefined) => {
      if (threadIdRef.current || paginatingBackRef.current) return;
      const shown = timelineRef.current;
      // The room's thread lists drop and add again roots that stay in the room; only the
      // timelines the window shows take its rows away.
      if (!removedFrom || !shown.linkedTimelines.includes(removedFrom)) return;
      const eventId = mEvent.getId();
      const rowIndex = roomRowsRef.current.findIndex(
        (row) => row === mEvent || (eventId !== undefined && row.getId() === eventId)
      );
      const range =
        rowIndex === -1 || !windowFollowsRowsRef.current
          ? undefined
          : getRangeWithoutRow(activeRangeRef.current, rowIndex);
      // A window set since the last render is newer than the rows the index came from.
      setTimeline((current) =>
        range && current.range === shown.range ? { ...current, range } : { ...current }
      );
    },
    [
      activeRangeRef,
      paginatingBackRef,
      roomRowsRef,
      setTimeline,
      threadIdRef,
      timelineRef,
      windowFollowsRowsRef,
    ]
  );
  useLiveEventRemove(room, handleRemove);
};

/** The ID of the event at the end of the loaded chain that a page towards `back` adds to. */
const loadedEdgeEventId = (timeline: EventTimeline, back: boolean): string | undefined => {
  const chain = getLinkedTimelines(timeline);
  const events = (back ? chain[0] : chain.at(-1))?.getEvents();
  return (back ? events?.[0] : events?.at(-1))?.getId();
};

/**
 * The paginator of the room's window. Upstream `anchorTo: 'end'` keeps the rows on screen in
 * place when older rows mount above the reader, and reaching either end of the window loads more
 * of the room. It counts in the room's rows; the state takes each window in loaded rows
 * (`loadedRangeOfRef`).
 */
export const useRoomWindowPaginator = ({
  alive,
  roomRows,
  roomRowsRef,
  activeTimelineRange,
  activeRangeRef,
  loadedRangeOfRef,
  firstRoomTimelineRef,
  lastRoomTimelineRef,
  scrollRef,
  setTimeline,
  paginateRoom,
  suppressFocusPaginationRef,
  windowLimit,
  getScrollElement,
  deferAutomaticPagination,
  readAhead,
}: {
  alive: () => boolean;
  roomRows: MatrixEvent[];
  roomRowsRef: MutableRefObject<MatrixEvent[]>;
  activeTimelineRange: ItemRange;
  activeRangeRef: MutableRefObject<ItemRange>;
  /** The loaded rows that a window of the room's rows stands for. */
  loadedRangeOfRef: MutableRefObject<(rowRange: ItemRange) => ItemRange>;
  firstRoomTimelineRef: MutableRefObject<EventTimeline | undefined>;
  lastRoomTimelineRef: MutableRefObject<EventTimeline | undefined>;
  scrollRef: MutableRefObject<HTMLElement | null>;
  setTimeline: SetTimeline;
  paginateRoom: (back: boolean) => Promise<void>;
  suppressFocusPaginationRef: MutableRefObject<boolean>;
  windowLimit: number;
  getScrollElement: () => HTMLElement | null;
  deferAutomaticPagination: (retry: () => boolean) => boolean;
  /** Pages a screen ahead of the reader; see `useVirtualPaginator`. */
  readAhead: boolean;
}) => {
  const handleRoomRangeChange = useCallback(
    (next: ItemRange, pagedFrom?: ItemRange) => {
      // A page towards newer rows keeps only the rows it measured on screen in the window it
      // widened. When another window was set after that render (the newest row kept, a live row
      // grown in), the page would undo it and drop rows the reader sees: it is dropped, and the
      // paginator looks at the sentinels again once that window renders.
      const loadedRangeOf = loadedRangeOfRef.current;
      const widened = pagedFrom && next.end > pagedFrom.end ? loadedRangeOf(pagedFrom) : undefined;
      const range = loadedRangeOf(next);
      setTimeline((currentTimeline) =>
        widened &&
        (currentTimeline.range.start !== widened.start || currentTimeline.range.end !== widened.end)
          ? currentTimeline
          : { ...currentTimeline, range }
      );
    },
    [loadedRangeOfRef, setTimeline]
  );
  const getRoomRowElement = useCallback(
    (index: number) =>
      scrollRef.current?.querySelector<HTMLElement>(
        `[data-room-row-index="${index - activeRangeRef.current.start}"]`
      ) ?? undefined,
    [activeRangeRef, scrollRef]
  );
  // A page that moves the room's back token but adds no rows (the server only moved its token,
  // or reached the room's start) leaves the window as it was: nothing else would show the room's
  // start or drop the sentinel, and the paginator, which follows window changes, would not ask
  // again while it stays in view. Each such page renders again and checks the sentinel once more.
  // So does a page that loaded events and left its token: a page from the cache that has no
  // token of its own keeps the room's, and its events can all go into the closed fold the rows
  // start with, which stays one row.
  // So does a page whose chain a limited sync replaced while it ran: the page asked for the new
  // chain meanwhile waited for it instead of running, and the new chain may hold only hidden
  // events, which leaves the room blank.
  // A page of newer events that adds no row to the room's rows leaves the window as it was, too:
  // one that only moved the room's forward token, or one whose events all went into the closed
  // fold the rows end with, which stays one row. Its sentinel is checked once more as well.
  // A page that neither moved its token nor loaded an event (it failed, or the room has no more)
  // is not asked for again by itself, in either direction.
  const [settledRoomPage, setSettledRoomPage] = useState<{
    rowsBefore: number;
    chainReplaced: boolean;
  }>();
  // A back page shows its rows before it settles (it still saves them, and the Classic view
  // looks for cached thread replies), and a request made meanwhile joins it. The page's own
  // request answers for it: when one joined, the paginator looks at the sentinel again once the
  // page settles, whatever the page added, since those rows can leave the sentinel in view.
  const backPageRef = useRef<{ page: Promise<void>; joined: boolean }>(undefined);
  const handleRoomPaginationEnd = useCallback(
    (back: boolean) => {
      const edge = back ? firstRoomTimelineRef.current : lastRoomTimelineRef.current;
      const direction = back ? Direction.Backward : Direction.Forward;
      const tokenBefore = edge?.getPaginationToken(direction);
      const edgeEventBefore = edge && loadedEdgeEventId(edge, back);
      const rowsBefore = roomRowsRef.current.length;
      const page = paginateRoom(back);
      if (back && backPageRef.current?.page === page) {
        backPageRef.current.joined = true;
        return;
      }
      const backPage = back ? { page, joined: false } : undefined;
      if (backPage) backPageRef.current = backPage;
      void page.then(() => {
        if (!edge || !alive()) return;
        const progressed =
          edge.getPaginationToken(direction) !== tokenBefore ||
          loadedEdgeEventId(edge, back) !== edgeEventBefore;
        if (!back) {
          if (progressed) setSettledRoomPage({ rowsBefore, chainReplaced: false });
          return;
        }
        const shown = firstRoomTimelineRef.current;
        const chainReplaced = !!shown && !getLinkedTimelines(shown).includes(edge);
        const joined = !!backPage?.joined;
        if (!chainReplaced && !progressed && !joined) return;
        setSettledRoomPage({
          rowsBefore: joined ? roomRowsRef.current.length : rowsBefore,
          chainReplaced,
        });
      });
    },
    [alive, firstRoomTimelineRef, lastRoomTimelineRef, paginateRoom, roomRowsRef]
  );
  const shouldSuppressPagination = useCallback(
    () => suppressFocusPaginationRef.current,
    [suppressFocusPaginationRef]
  );
  const paginator = useVirtualPaginator({
    count: roomRows.length,
    range: activeTimelineRange,
    onRangeChange: handleRoomRangeChange,
    limit: windowLimit,
    getScrollElement,
    getItemElement: getRoomRowElement,
    onEnd: handleRoomPaginationEnd,
    shouldSuppressPagination,
    deferAutomaticPagination,
    readAhead,
    externalBackwardScrollRestore: true,
  });
  return {
    paginator,
    settledRoomPage,
    getRoomRowElement,
  };
};

/**
 * A page that added no row to the room's rows, or a back page that went to a chain the room no
 * longer shows, asks the paginator again; one with rows moved the window.
 */
export const useRetryAfterPageWithoutRows = (
  settledRoomPage: { rowsBefore: number; chainReplaced: boolean } | undefined,
  roomRowsRef: MutableRefObject<MatrixEvent[]>,
  retryPagination: () => void
) => {
  useLayoutEffect(() => {
    if (!settledRoomPage) return;
    // A page that added rows moved the window, and the paginator carries on from there.
    if (settledRoomPage.chainReplaced || roomRowsRef.current.length === settledRoomPage.rowsBefore)
      retryPagination();
  }, [retryPagination, settledRoomPage, roomRowsRef]);
};

/**
 * Scrolling near the top of a thread's loaded rows asks for older ones. It follows the reader's
 * scrolling: a page that added nothing must not ask again by itself.
 */
export const useThreadAutoPaginateBack = ({
  scrollElement,
  virtualizerRef,
  ...state
}: {
  scrollElement: HTMLElement | null;
  virtualizerRef: MutableRefObject<Pick<Virtualizer<HTMLDivElement, Element>, 'getVirtualItems'>>;
  threadId: string | undefined;
  paginatingBack: boolean;
  showLoadOlder: boolean;
  hasUserScrollIntent: boolean;
  leadingOffset?: number;
  paginateBack: () => Promise<unknown>;
}) => {
  const { threadId } = state;
  const autoPaginateRef = useLatestRef(state);
  useEffect(() => {
    if (!scrollElement || !threadId) return undefined;
    const checkTop = () => {
      const current = autoPaginateRef.current;
      const offset = current.leadingOffset ?? 0;
      const firstEventItem = virtualizerRef.current
        .getVirtualItems()
        .find((item) => item.index >= offset);
      const shouldPaginate = shouldAutoPaginateThreadBack({
        threadId: current.threadId,
        firstRenderedIndex: firstEventItem ? firstEventItem.index - offset : undefined,
        paginatingBack: current.paginatingBack,
        showLoadOlder: current.showLoadOlder,
        hasUserScrollIntent: current.hasUserScrollIntent,
        triggerRows: THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS,
      });
      if (!shouldPaginate) return;
      // The probe tells this trigger apart from the open's own history pages.
      countCacheProbe('threadAutoPaginateBackFired');
      void current.paginateBack();
    };
    // At the very top a turn of the wheel or a drag moves nothing and fires no scroll event, so
    // those count as the reader's scrolling too.
    const events = ['scroll', 'wheel', 'touchmove'] as const;
    events.forEach((type) => scrollElement.addEventListener(type, checkTop, { passive: true }));
    return () => events.forEach((type) => scrollElement.removeEventListener(type, checkTop));
  }, [autoPaginateRef, scrollElement, threadId, virtualizerRef]);
};
