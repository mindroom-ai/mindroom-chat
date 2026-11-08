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
  EventType,
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
  const windowEndRef = useRef<{ end: number; count: number }>();
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

type RoomRowFoldPrice = (key: string | number | bigint, index: number) => number;

/**
 * The paginator of the room's window. Rows mounted above the reader put their height into the
 * offset ledger (`pendingRoomFoldPxRef`, priced by `roomFoldPriceRef`), so the rows on screen stay
 * where they are, and reaching either end of the window loads more of the room.
 */
export const useRoomWindowPaginator = ({
  alive,
  roomRows,
  roomRowsRef,
  activeTimelineRange,
  activeRangeRef,
  threadIdRef,
  firstRoomTimelineRef,
  scrollRef,
  setTimeline,
  paginateRoom,
  suppressFocusPaginationRef,
  windowLimit,
  getScrollElement,
  deferAutomaticPagination,
}: {
  alive: () => boolean;
  roomRows: MatrixEvent[];
  roomRowsRef: MutableRefObject<MatrixEvent[]>;
  activeTimelineRange: ItemRange;
  activeRangeRef: MutableRefObject<ItemRange>;
  threadIdRef: MutableRefObject<string | undefined>;
  firstRoomTimelineRef: MutableRefObject<EventTimeline | undefined>;
  scrollRef: MutableRefObject<HTMLElement | null>;
  setTimeline: SetTimeline;
  paginateRoom: (back: boolean) => Promise<void>;
  suppressFocusPaginationRef: MutableRefObject<boolean>;
  windowLimit: number;
  getScrollElement: () => HTMLElement | null;
  deferAutomaticPagination: (retry: () => boolean) => boolean;
}) => {
  const pendingRoomFoldPxRef = useRef(0);
  // The window the pending fold was priced against: a render that still shows it has not mounted
  // the fold's rows.
  const roomFoldWindowRef = useRef<ItemRange>();
  const roomFoldPriceRef = useRef<RoomRowFoldPrice>(() => 0);
  const handleRoomRangeChange = useCallback(
    (next: ItemRange, pagedFrom?: ItemRange) => {
      const current = activeRangeRef.current;
      if (!threadIdRef.current && next.start < current.start) {
        // Rows mounted above the reader: their height goes into the ledger, so the rows on
        // screen stay where they are.
        let foldPx = 0;
        for (let index = next.start; index < Math.min(current.start, next.end); index += 1) {
          const key = roomRowsRef.current[index]?.getId() ?? index;
          // Priced by its place in the window still mounted, which the estimate reads.
          foldPx += roomFoldPriceRef.current(key, index - current.start);
        }
        pendingRoomFoldPxRef.current += foldPx;
        roomFoldWindowRef.current = current;
      }
      // A page towards newer rows keeps only the rows it measured on screen in the window it
      // widened. When another window was set after that render (the newest row kept, a live row
      // grown in), the page would undo it and drop rows the reader sees: it is dropped, and the
      // paginator looks at the sentinels again once that window renders.
      const widened = pagedFrom && next.end > pagedFrom.end ? pagedFrom : undefined;
      setTimeline((currentTimeline) =>
        widened &&
        (currentTimeline.range.start !== widened.start || currentTimeline.range.end !== widened.end)
          ? currentTimeline
          : { ...currentTimeline, range: next }
      );
    },
    [activeRangeRef, roomRowsRef, setTimeline, threadIdRef]
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
  // So does a page whose chain a limited sync replaced while it ran: the page asked for the new
  // chain meanwhile waited for it instead of running, and the new chain may hold only hidden
  // events, which leaves the room blank.
  const [roomBackPage, setRoomBackPage] = useState<{
    rowsBefore: number;
    chainReplaced: boolean;
  }>();
  // A back page shows its rows before it settles (it still saves them, and the Classic view
  // looks for cached thread replies), and a request made meanwhile joins it. The page's own
  // request answers for it: when one joined, the paginator looks at the sentinel again once the
  // page settles, whatever the page added, since those rows can leave the sentinel in view.
  const backPageRef = useRef<{ page: Promise<void>; joined: boolean }>();
  const handleRoomPaginationEnd = useCallback(
    (back: boolean) => {
      const edge = back ? firstRoomTimelineRef.current : undefined;
      const tokenBefore = edge?.getPaginationToken(Direction.Backward);
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
        const shown = firstRoomTimelineRef.current;
        const chainReplaced = !!shown && !getLinkedTimelines(shown).includes(edge);
        const joined = !!backPage?.joined;
        const tokenMoved = edge.getPaginationToken(Direction.Backward) !== tokenBefore;
        if (!chainReplaced && !tokenMoved && !joined) return;
        setRoomBackPage({
          rowsBefore: joined ? roomRowsRef.current.length : rowsBefore,
          chainReplaced,
        });
      });
    },
    [alive, firstRoomTimelineRef, paginateRoom, roomRowsRef]
  );
  const shouldSuppressPagination = useCallback(
    () => suppressFocusPaginationRef.current,
    [suppressFocusPaginationRef]
  );
  // The opening fill loads a screen of history above the reader. A room whose creation is loaded
  // has nothing older to load ahead: its rows above the reader, and its start, mount as the reader
  // scrolls up to them.
  const automaticBackReach = useCallback(() => {
    const first = firstRoomTimelineRef.current?.getEvents()[0];
    if (first?.getType() === EventType.RoomCreate) return 0;
    return scrollRef.current?.clientHeight ?? 0;
  }, [firstRoomTimelineRef, scrollRef]);
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
    automaticBackReach,
    externalBackwardScrollRestore: true,
  });
  return {
    paginator,
    pendingRoomFoldPxRef,
    roomFoldWindowRef,
    roomFoldPriceRef,
    roomBackPage,
    getRoomRowElement,
  };
};

/**
 * A back page that added no rows, or that went to a chain the room no longer shows, asks the
 * paginator again; one with rows moved the window.
 */
export const useRetryAfterEmptyBackPage = (
  roomBackPage: { rowsBefore: number; chainReplaced: boolean } | undefined,
  roomRowsRef: MutableRefObject<MatrixEvent[]>,
  retryPagination: () => void
) => {
  useLayoutEffect(() => {
    if (!roomBackPage) return;
    // A page that added rows moved the window, and the paginator carries on from there.
    if (roomBackPage.chainReplaced || roomRowsRef.current.length === roomBackPage.rowsBefore)
      retryPagination();
  }, [retryPagination, roomBackPage, roomRowsRef]);
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
  paginateBack: () => Promise<unknown>;
}) => {
  const { threadId } = state;
  const autoPaginateRef = useLatestRef(state);
  useEffect(() => {
    if (!scrollElement || !threadId) return undefined;
    const checkTop = () => {
      const current = autoPaginateRef.current;
      const shouldPaginate = shouldAutoPaginateThreadBack({
        threadId: current.threadId,
        firstRenderedIndex: virtualizerRef.current.getVirtualItems()[0]?.index,
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
