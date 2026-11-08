import { createElement, useLayoutEffect, useRef, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { Direction, type EventTimeline, type MatrixEvent } from 'matrix-js-sdk';
import type { ItemRange } from './useVirtualPaginator';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import {
  useRetryAfterEmptyBackPage,
  useRoomWindowPaginator,
  useWindowKeepsNewestRow,
} from './roomTimelinePaginationWindow';
import { getVisibleTimelineRange, type Timeline } from '../event-store/timeline/timelinePagination';

const ROW_PX = 40;
const VIEW_PX = 720;

const rectAt = (top: number, height: number) => ({ top, bottom: top + height, height });

type Shown = { range: ItemRange; count: number };

/**
 * The room's scroll area as the browser lays it out: the back sentinel (1 px) and then the
 * window's rows from the top of the content, and the front sentinel below the last row while
 * newer rows wait outside the window. Each row's `data-room-row-index` element sits inside its
 * absolutely placed tile, so its `offsetTop` is 0. The reader stays at the bottom (or the top)
 * as the rows change, until something scrolls the content.
 */
const fakeRoomScroller = (reader: 'bottom' | 'top' = 'bottom') => {
  const shown: { current: Shown } = { current: { range: { start: 0, end: 0 }, count: 0 } };
  const contentPx = () => 1 + (shown.current.range.end - shown.current.range.start) * ROW_PX;
  const maxScrollTop = () => Math.max(0, contentPx() - VIEW_PX);
  let scrolledTo: number | undefined;
  const scrollTop = () =>
    Math.min(maxScrollTop(), Math.max(0, scrolledTo ?? (reader === 'bottom' ? maxScrollTop() : 0)));
  const scroller = {
    get scrollTop() {
      return scrollTop();
    },
    clientTop: 0,
    offsetHeight: VIEW_PX,
    getBoundingClientRect: () => rectAt(0, VIEW_PX),
    scrollBy: ({ top = 0 }: { top?: number }) => {
      scrolledTo = scrollTop() + top;
    },
    querySelector: (selector: string) => {
      const { range, count } = shown.current;
      const contentTop = -scrollTop();
      if (selector.includes('data-paginator-anchor="B"')) {
        return range.start > 0 ? { getBoundingClientRect: () => rectAt(contentTop, 1) } : null;
      }
      if (selector.includes('data-paginator-anchor="F"')) {
        const bottom = contentTop + contentPx();
        return range.end < count ? { getBoundingClientRect: () => rectAt(bottom - 1, 1) } : null;
      }
      const offset = Number(/data-room-row-index="(\d+)"/.exec(selector)?.[1]);
      if (!Number.isInteger(offset) || offset >= range.end - range.start) return null;
      return {
        offsetParent: {},
        offsetTop: 0,
        clientHeight: ROW_PX,
        getBoundingClientRect: () => rectAt(contentTop + 1 + offset * ROW_PX, ROW_PX),
      };
    },
  };
  return { shown, element: scroller as unknown as HTMLElement };
};

const makeRows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ getId: () => `$row${index}` } as MatrixEvent));

type Committed = [start: number, end: number, count: number];

type Handles = {
  setTimeline?: (update: (current: Timeline) => Timeline) => void;
  paginator?: ReturnType<typeof useRoomWindowPaginator>['paginator'];
};

type RoomWindowProps = {
  rows: MatrixEvent[];
  initialRange: ItemRange;
  windowLimit: number;
  eventId: string | undefined;
  scroller: ReturnType<typeof fakeRoomScroller>;
  commits: Committed[];
  handles: Handles;
};

/** The room view's window as the room timeline wires it: kept at the newest row, and paged. */
function RoomWindow({
  rows,
  initialRange,
  windowLimit,
  eventId,
  scroller,
  commits,
  handles,
}: RoomWindowProps) {
  const [timeline, setTimeline] = useState<Timeline>({
    linkedTimelines: [],
    range: initialRange,
  });
  const activeTimelineRange = getVisibleTimelineRange(timeline.range, rows.length, windowLimit);
  const roomRowsRef = useLatestRef(rows);
  const activeRangeRef = useLatestRef(activeTimelineRange);
  const threadIdRef = useRef<string>();
  const firstRoomTimelineRef = useRef<EventTimeline>();
  const scrollRef = useRef<HTMLElement | null>(scroller.element);
  const suppressFocusPaginationRef = useRef(false);
  useLayoutEffect(() => {
    scroller.shown.current = { range: activeTimelineRange, count: rows.length };
    commits.push([activeTimelineRange.start, activeTimelineRange.end, rows.length]);
  });
  useWindowKeepsNewestRow({
    activeTimelineRange,
    eventId,
    roomRowCount: rows.length,
    threadId: undefined,
    setTimeline,
  });
  const { paginator } = useRoomWindowPaginator({
    alive: () => true,
    roomRows: rows,
    roomRowsRef,
    activeTimelineRange,
    activeRangeRef,
    threadIdRef,
    firstRoomTimelineRef,
    scrollRef,
    setTimeline,
    paginateRoom: () => Promise.resolve(),
    suppressFocusPaginationRef,
    windowLimit,
    getScrollElement: () => scroller.element,
    deferAutomaticPagination: () => false,
    readAhead: true,
  });
  handles.setTimeline = setTimeline;
  handles.paginator = paginator;
  return null;
}

/** What the live handler does for a row the sync appends: the window's end grows by one. */
const growByLiveRow = (current: Timeline): Timeline => ({
  ...current,
  range: { start: current.range.start, end: current.range.end + 1 },
});

type MountOptions = {
  windowLimit?: number;
  /** Where the reader is while nothing scrolls the content. */
  reader?: 'bottom' | 'top';
  /** The room opened at this event, so a window short of the newest row stays short. */
  eventId?: string;
};

const mountRoomWindow = (
  rowCount: number,
  initialRange: ItemRange,
  { windowLimit = 200, reader = 'bottom', eventId }: MountOptions = {}
) => {
  const scroller = fakeRoomScroller(reader);
  const commits: Committed[] = [];
  const handles: Handles = {};
  let renderer: ReactTestRenderer | undefined;
  const element = (count: number) =>
    createElement(RoomWindow, {
      rows: makeRows(count),
      initialRange,
      windowLimit,
      eventId,
      scroller,
      commits,
      handles,
    });
  act(() => {
    renderer = create(element(rowCount));
  });
  /** One render with `count` rows and whatever `during` queues before it. */
  const renderWith = (count: number, during: () => void) =>
    act(() => {
      renderer?.update(element(count));
      during();
    });
  /** Where the row at `index` of the room is painted, relative to the top of the view. */
  const rowTop = (index: number) =>
    scroller.element
      .querySelector<HTMLElement>(`[data-room-row-index="${index - (commits.at(-1)?.[0] ?? 0)}"]`)
      ?.getBoundingClientRect().top;
  return { commits, handles, renderWith, rowTop };
};

describe('the room window paginator', () => {
  // The windows below are more than two screens tall: pagination reads a screen ahead of the view,
  // so a sentinel within a screen of it would page as well.
  it('drops a page towards newer rows measured before the window was kept at the newest row', () => {
    // A Full view window of rows 10 to 51 that reaches the newest row, the reader at the bottom.
    const { commits, handles, renderWith } = mountRoomWindow(51, { start: 10, end: 51 });
    // In one render, a thread's older reply joins the rows above the window and a live row
    // arrives: the live handler grows the window's end by one, which leaves it a row short.
    renderWith(53, () => handles.setTimeline?.(growByLiveRow));
    // The window is kept at the newest row. The paginator's page from the short window, measured
    // before, and the back page that follows (it mounts the room's start) may not land.
    expect(commits).toEqual([
      [10, 51, 51],
      [10, 52, 53],
      [10, 53, 53],
    ]);
  });

  it('applies a page towards newer rows when no other window was set after its render', () => {
    // A window that stops short of the newest rows (the room opened at an event), its front
    // sentinel in view.
    const { commits, handles, renderWith } = mountRoomWindow(
      60,
      { start: 10, end: 50 },
      { eventId: '$row40' }
    );
    renderWith(60, () => {
      // A repaint that keeps the window (a new range object with the same rows) is no newer.
      handles.setTimeline?.((current) => ({ ...current, range: { ...current.range } }));
      handles.paginator?.retryPagination();
    });
    // The page lands: the next window reaches the newest row.
    expect(commits[0]).toEqual([10, 50, 60]);
    expect(commits[1]?.slice(1)).toEqual([60, 60]);
  });

  it('keeps the rows on screen when it pages towards newer rows in a window it all mounted', () => {
    // The window stops short of the newest rows with every row mounted, the reader at its bottom:
    // rows 10 to 31 are above the view, row 32 is the first one the reader sees.
    const { commits, handles, rowTop } = mountRoomWindow(
      60,
      { start: 10, end: 50 },
      { eventId: '$row40' }
    );
    expect(rowTop(32)).toBe(0);
    act(() => handles.paginator?.retryPagination());
    // The page keeps the rows within a screen above the view (14 to 31), the row above them and
    // everything after them, not only the window's last row, and the reader's row stays where it
    // was.
    expect(commits).toEqual([
      [10, 50, 60],
      [13, 60, 60],
    ]);
    expect(rowTop(32)).toBe(0);
  });

  it('keeps the rows within a screen below the view and one more when it pages towards older rows', () => {
    // The reader at the top of a window it all mounted: rows 30 to 47 fill the view, rows 48 to
    // 65 are within a screen below it.
    const { commits, handles } = mountRoomWindow(
      100,
      { start: 30, end: 90 },
      { reader: 'top', eventId: '$row40' }
    );
    act(() => handles.paginator?.retryPagination());
    expect(commits).toEqual([
      [30, 90, 100],
      [0, 67, 100],
    ]);
  });

  it('applies a jump to a row outside the window over a window set after its render', () => {
    const { commits, handles, renderWith } = mountRoomWindow(
      60,
      { start: 40, end: 60 },
      { windowLimit: 20 }
    );
    renderWith(61, () => {
      handles.setTimeline?.(growByLiveRow);
      handles.paginator?.scrollToItem(5);
    });
    expect(commits).toEqual([
      [40, 60, 60],
      [0, 20, 61],
    ]);
  });
});

/** A loaded stretch of the room with a back token and no neighbours. */
const fakeTimeline = (token: string | null) => {
  let backToken = token;
  return {
    getPaginationToken: (direction: Direction) =>
      direction === Direction.Backward ? backToken : null,
    setBackToken: (next: string | null) => {
      backToken = next;
    },
    getNeighbouringTimeline: () => null,
    getEvents: () => [],
  };
};

/** A scroll area whose back sentinel is in view: a short room, or one showing no rows. */
const roomScrollerWithBackSentinel = () =>
  ({
    scrollTop: 0,
    clientTop: 0,
    offsetHeight: VIEW_PX,
    getBoundingClientRect: () => rectAt(0, VIEW_PX),
    scrollBy: () => undefined,
    querySelector: (selector: string) =>
      selector.includes('data-paginator-anchor="B"')
        ? { getBoundingClientRect: () => rectAt(VIEW_PX - 100, 1) }
        : null,
  } as unknown as HTMLElement);

type ChainProps = {
  chain: EventTimeline[];
  rows: MatrixEvent[];
  paginateRoom: (back: boolean) => Promise<void>;
  handles: Handles;
};

/** The room's window as the room timeline wires it, with its retry after a page. */
function RoomChainWindow({ chain, rows, paginateRoom, handles }: ChainProps) {
  const [scroller] = useState(roomScrollerWithBackSentinel);
  const [timeline, setTimeline] = useState<Timeline>({
    linkedTimelines: chain,
    range: { start: 0, end: rows.length },
  });
  const activeTimelineRange = getVisibleTimelineRange(timeline.range, rows.length, 200);
  const roomRowsRef = useLatestRef(rows);
  const activeRangeRef = useLatestRef(activeTimelineRange);
  const threadIdRef = useRef<string>();
  const firstRoomTimelineRef = useLatestRef(chain[0]);
  const scrollRef = useRef<HTMLElement | null>(scroller);
  const suppressFocusPaginationRef = useRef(false);
  const { paginator, roomBackPage } = useRoomWindowPaginator({
    alive: () => true,
    roomRows: rows,
    roomRowsRef,
    activeTimelineRange,
    activeRangeRef,
    threadIdRef,
    firstRoomTimelineRef,
    scrollRef,
    setTimeline,
    paginateRoom,
    suppressFocusPaginationRef,
    windowLimit: 200,
    getScrollElement: () => scroller,
    deferAutomaticPagination: () => false,
    readAhead: true,
  });
  useRetryAfterEmptyBackPage(roomBackPage, roomRowsRef, paginator.retryPagination);
  handles.setTimeline = setTimeline;
  handles.paginator = paginator;
  return null;
}

describe('a back page whose rows show before it settles', () => {
  it('asks again once it settles while the sentinel is still in view', async () => {
    const chain = fakeTimeline('token-2');
    // Back pages run one at a time, as the room's pagination command runs them: a page asked for
    // while one runs joins that one.
    let asked = 0;
    const started: (string | null)[] = [];
    const pending: (() => void)[] = [];
    let running: Promise<void> | undefined;
    const paginateRoom = () => {
      asked += 1;
      if (!running) {
        started.push(chain.getPaginationToken(Direction.Backward));
        running = new Promise<void>((resolve) => {
          pending.push(resolve);
        }).finally(() => {
          running = undefined;
        });
      }
      return running;
    };
    const handles: Handles = {};
    const element = (rowCount: number) =>
      createElement(RoomChainWindow, {
        chain: [chain as unknown as EventTimeline],
        rows: makeRows(rowCount),
        paginateRoom,
        handles,
      });
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(element(5));
    });
    act(() => handles.paginator?.retryPagination());
    expect(started).toEqual(['token-2']);

    // The page brings one row, which shows while the page still finishes (it saves the page and
    // looks for cached thread replies). The window grows by it, the sentinel is still in view and
    // asks for the next page, and that request joins the page still out.
    chain.setBackToken('token-1');
    act(() => {
      renderer?.update(element(6));
      handles.setTimeline?.((current) => ({ ...current, range: { start: 0, end: 6 } }));
    });
    expect(asked).toBe(2);
    expect(started).toEqual(['token-2']);

    // The page settles with the sentinel still in view: the next page loads.
    await act(async () => {
      pending.shift()?.();
      await running;
    });
    expect(started).toEqual(['token-2', 'token-1']);
    act(() => renderer?.unmount());
  });
});

describe('a back page while a limited sync replaces the room chain', () => {
  it.each([true, false])(
    'asks again for the new chain once the old page lands (token moved: %s)',
    async (tokenMoved) => {
      const oldChain = fakeTimeline('old-1');
      const newChain = fakeTimeline('new-1');
      // Back pages run one at a time, as the room's pagination command runs them: a page asked for
      // while one runs waits for that one.
      const pagedChains: unknown[] = [];
      const startedChains: unknown[] = [];
      const pending: (() => void)[] = [];
      let running: Promise<void> | undefined;
      let shownChain: unknown = oldChain;
      const paginateRoom = () => {
        pagedChains.push(shownChain);
        if (!running) {
          startedChains.push(shownChain);
          running = new Promise<void>((resolve) => {
            pending.push(resolve);
          }).finally(() => {
            running = undefined;
          });
        }
        return running;
      };
      const handles: Handles = {};
      const element = (chain: unknown, rowCount: number) =>
        createElement(RoomChainWindow, {
          chain: [chain as EventTimeline],
          rows: makeRows(rowCount),
          paginateRoom,
          handles,
        });
      let renderer: ReactTestRenderer | undefined;
      act(() => {
        renderer = create(element(oldChain, 5));
      });

      // The sentinel of the short room asks for older history.
      act(() => handles.paginator?.retryPagination());
      expect(pagedChains).toEqual([oldChain]);

      // The rename arrives in a limited sync: the room's chain is now a new one, whose only event
      // the timeline hides. The emptied window asks for older history while the old page runs.
      shownChain = newChain;
      act(() => {
        renderer?.update(element(newChain, 0));
      });
      expect(pagedChains).toEqual([oldChain, newChain]);

      // The page lands in the old chain, which the room no longer shows.
      if (tokenMoved) oldChain.setBackToken('old-0');
      await act(async () => {
        pending.shift()?.();
        await running;
      });

      // The new chain is asked for again, so its older events load and the room shows its rows.
      expect(pagedChains).toEqual([oldChain, newChain, newChain]);
      expect(startedChains).toEqual([oldChain, newChain]);

      // A completion without progress in the current chain must stop, even though rows still
      // number zero. The two callers that waited on the old page must not duplicate this request.
      await act(async () => {
        pending.shift()?.();
        await running;
      });
      expect(pagedChains).toEqual([oldChain, newChain, newChain]);
      expect(startedChains).toEqual([oldChain, newChain]);
      act(() => renderer?.unmount());
    }
  );
});
