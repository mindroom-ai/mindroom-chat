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
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import type { Virtualizer } from '@tanstack/react-virtual';
import { useVirtualPaginator, type ItemRange } from '../../hooks/useVirtualPaginator';
import { useLiveEventRemove } from './roomLiveEventArrive';
import { getRangeWithoutRow, type Timeline } from './timelinePagination';
import { shouldAutoPaginateThreadBack } from './threadRenderUtils';
import { countCacheProbe } from './cacheProbe';
import { THREAD_BACK_AUTO_PAGINATE_TRIGGER_ROWS } from './preloadSettings';
import { useLatestRef } from './roomTimelineViewScope';

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
  const roomFoldPriceRef = useRef<RoomRowFoldPrice>(() => 0);
  const handleRoomRangeChange = useCallback(
    (next: ItemRange) => {
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
      }
      setTimeline((currentTimeline) => ({ ...currentTimeline, range: next }));
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
  const [roomBackPage, setRoomBackPage] = useState<{ rowsBefore: number }>();
  const handleRoomPaginationEnd = useCallback(
    (back: boolean) => {
      const edge = back ? firstRoomTimelineRef.current : undefined;
      const tokenBefore = edge?.getPaginationToken(Direction.Backward);
      const rowsBefore = roomRowsRef.current.length;
      void paginateRoom(back).then(() => {
        if (!edge || !alive() || edge.getPaginationToken(Direction.Backward) === tokenBefore)
          return;
        setRoomBackPage({ rowsBefore });
      });
    },
    [alive, firstRoomTimelineRef, paginateRoom, roomRowsRef]
  );
  const shouldSuppressPagination = useCallback(
    () => suppressFocusPaginationRef.current,
    [suppressFocusPaginationRef]
  );
  // The opening fill loads a screen of history above the reader. A short room, whose creation
  // event came with the sync, has nothing older to load ahead: its start (the room intro) shows
  // once the reader scrolls up to it.
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
  return { paginator, pendingRoomFoldPxRef, roomFoldPriceRef, roomBackPage };
};

/** A back page that added no rows asks the paginator again; one with rows moved the window. */
export const useRetryAfterEmptyBackPage = (
  roomBackPage: { rowsBefore: number } | undefined,
  roomRowsRef: MutableRefObject<MatrixEvent[]>,
  retryPagination: () => void
) => {
  useLayoutEffect(() => {
    // A page that added rows moved the window, and the paginator carries on from there.
    if (roomBackPage && roomRowsRef.current.length === roomBackPage.rowsBefore) retryPagination();
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
    scrollElement.addEventListener('scroll', checkTop, { passive: true });
    return () => scrollElement.removeEventListener('scroll', checkTop);
  }, [autoPaginateRef, scrollElement, threadId, virtualizerRef]);
};
