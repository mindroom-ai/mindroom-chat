import { EventEmitter } from 'events';
import { createElement, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it } from 'vitest';
import { Direction, MatrixEvent, type EventTimeline, type MatrixClient } from 'matrix-js-sdk';
import type { ItemRange } from './useVirtualPaginator';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import {
  useRetryAfterPageWithoutRows,
  useRoomWindowPaginator,
  useWindowHoldsWholeFolds,
  useWindowKeepsNewestRow,
} from './roomTimelinePaginationWindow';
import { getVisibleTimelineRange, type Timeline } from '../event-store/timeline/timelinePagination';
import { loadedRangeOfRows, type MembershipFoldView } from './membershipFolds';
import { useMembershipFolds, useRoomRowWindow } from './useMembershipFolds';

// The room's window over rows with folded membership runs, wired as the room timeline wires it:
// the state counts loaded rows, and the paginator, its sentinels and its row elements count the
// room's rows, where a closed fold is one row.

const VIEW_PX = 600;
const MESSAGE_PX = 40;
const MEMBER_PX = 30;
const BREAK_PX = 42;
const ROOM_ID = '!room:example.org';
const TS = new Date(2026, 10, 3, 12, 0).getTime();

const message = (id: string): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: '@sam:example.org',
    type: 'm.room.message',
    origin_server_ts: TS,
    content: { body: id, msgtype: 'm.text' },
  });

const join = (id: string): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender: `@${id.slice(1)}:example.org`,
    state_key: `@${id.slice(1)}:example.org`,
    type: 'm.room.member',
    origin_server_ts: TS,
    content: { membership: 'join', displayname: id.slice(1) },
  });

const messages = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => message(`$${prefix}${index}`));
const joins = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => join(`$${prefix}${index}`));

const rectAt = (top: number, height: number) => ({ top, bottom: top + height, height });

type Shown = {
  /** The rows of the window, and how many rows the room has. */
  rows: MatrixEvent[];
  range: ItemRange;
  count: number;
  view: MembershipFoldView;
  moreHistory: boolean;
  /** Newer events of the room wait at the server, past the loaded rows. */
  moreNewer: boolean;
};

/**
 * The room's scroll area as the browser lays it out: the back sentinel (1 px), then one element
 * per row of the window, then the front sentinel while newer rows wait outside the window or at
 * the server.
 */
const fakeRoomScroller = () => {
  const shown: { current: Shown } = {
    current: {
      rows: [],
      range: { start: 0, end: 0 },
      count: 0,
      view: { breaks: new Map() },
      moreHistory: false,
      moreNewer: false,
    },
  };
  const rowPx = (event: MatrixEvent) => {
    const fold = shown.current.view.breaks.get(event.getId() ?? '');
    if (fold?.open === false) return BREAK_PX;
    const px = event.getType() === 'm.room.member' ? MEMBER_PX : MESSAGE_PX;
    return fold ? px + BREAK_PX : px;
  };
  const rowTop = (offset: number) =>
    shown.current.rows.slice(0, offset).reduce((px, event) => px + rowPx(event), 1);
  const contentPx = () => rowTop(shown.current.rows.length);
  let scrollTop = 0;
  const clamp = () => {
    scrollTop = Math.min(Math.max(0, contentPx() - VIEW_PX), Math.max(0, scrollTop));
    return scrollTop;
  };
  const scroller = {
    get scrollTop() {
      return clamp();
    },
    clientTop: 0,
    offsetHeight: VIEW_PX,
    getBoundingClientRect: () => rectAt(0, VIEW_PX),
    scrollBy: ({ top = 0 }: { top?: number }) => {
      scrollTop = clamp() + top;
    },
    querySelector: (selector: string) => {
      const { rows, range, count, moreHistory, moreNewer } = shown.current;
      const contentTop = -clamp();
      if (selector.includes('data-paginator-anchor="B"')) {
        return range.start > 0 || moreHistory
          ? { getBoundingClientRect: () => rectAt(contentTop, 1) }
          : null;
      }
      if (selector.includes('data-paginator-anchor="F"')) {
        return range.end < count || moreNewer
          ? { getBoundingClientRect: () => rectAt(contentTop + contentPx() - 1, 1) }
          : null;
      }
      const offset = Number(/data-room-row-index="(\d+)"/.exec(selector)?.[1]);
      const row = Number.isInteger(offset) ? rows[offset] : undefined;
      if (!row) return null;
      const height = rowPx(row);
      return {
        offsetParent: {},
        offsetTop: 0,
        clientHeight: height,
        getBoundingClientRect: () => rectAt(contentTop + rowTop(offset), height),
      };
    },
  };
  return {
    shown,
    element: scroller as unknown as HTMLElement,
    rowPx,
    scrollTo: (top: number) => {
      scrollTop = top;
    },
    /** Where the row of `id` is painted, from the top of the view. */
    screenTop: (id: string) => {
      const offset = shown.current.rows.findIndex((event) => event.getId() === id);
      return offset === -1 ? undefined : rowTop(offset) - clamp();
    },
  };
};

/** A loaded stretch of the room with its tokens and no neighbours. */
const fakeTimeline = (token: string | null, newerToken: string | null = null) => {
  let backToken = token;
  let forwardToken = newerToken;
  return {
    getPaginationToken: (direction: Direction) =>
      direction === Direction.Backward ? backToken : forwardToken,
    setBackToken: (next: string | null) => {
      backToken = next;
    },
    setForwardToken: (next: string | null) => {
      forwardToken = next;
    },
    getNeighbouringTimeline: () => null,
    getEvents: () => [],
  };
};

type Handles = {
  setTimeline?: (update: (current: Timeline) => Timeline) => void;
  paginator?: ReturnType<typeof useRoomWindowPaginator>['paginator'];
  /** The height of the rows that pages mounted above the reader, which the ledger took. */
  foldedPx: number;
  toggle?: (id: string) => void;
  /** As of the last commit. */
  stateRange?: ItemRange;
  rowRange?: ItemRange;
  roomRowIds?: (string | undefined)[];
};

type RoomWindowProps = {
  loaded: MatrixEvent[];
  initialRange: ItemRange;
  windowLimit: number;
  /** The room opened at this event, so a window short of the newest row stays short. */
  eventId?: string;
  chain?: ReturnType<typeof fakeTimeline>;
  paginateRoom?: (back: boolean) => Promise<void>;
  scroller: ReturnType<typeof fakeRoomScroller>;
  handles: Handles;
};

const NOT_SKIPPED = () => false;
const NO_PINS: ReadonlySet<string> = new Set();

/** The room's window as the room timeline wires it. */
function RoomWindow({
  loaded,
  initialRange,
  windowLimit,
  eventId,
  chain,
  paginateRoom = () => Promise.resolve(),
  scroller,
  handles,
}: RoomWindowProps) {
  const [mx] = useState(() => new EventEmitter() as unknown as MatrixClient);
  const [timeline, setTimeline] = useState<Timeline>({
    linkedTimelines: [],
    range: initialRange,
  });
  const entries = useMemo(
    () => loaded.map((event, absoluteIndex) => ({ event, absoluteIndex })),
    [loaded]
  );
  const stateRange = useMemo(
    () => getVisibleTimelineRange(timeline.range, loaded.length, windowLimit),
    [loaded.length, timeline.range, windowLimit]
  );
  const folds = useMembershipFolds({
    mx,
    roomId: ROOM_ID,
    enabled: true,
    events: loaded,
    entries,
    isSkipped: NOT_SKIPPED,
    pinnedIds: NO_PINS,
  });
  const projection = folds.rows;
  const projectionRef = useLatestRef(projection);
  const roomRows = projection.rows;
  const roomRowsRef = useLatestRef(roomRows);
  const { rowRange, loadedRange } = useRoomRowWindow(projection, stateRange);
  const activeRangeRef = useLatestRef(rowRange);
  const loadedRangeOfRef = useRef((rows: ItemRange) =>
    loadedRangeOfRows(projectionRef.current, rows)
  );
  const threadIdRef = useRef<string>();
  const firstRoomTimelineRef = useLatestRef(chain as unknown as EventTimeline | undefined);
  const lastRoomTimelineRef = firstRoomTimelineRef;
  const scrollRef = useRef<HTMLElement | null>(scroller.element);
  const suppressFocusPaginationRef = useRef(false);
  useLayoutEffect(() => {
    scroller.shown.current = {
      rows: roomRows.slice(rowRange.start, rowRange.end),
      range: rowRange,
      count: roomRows.length,
      view: folds.view,
      moreHistory: !!chain?.getPaginationToken(Direction.Backward),
      moreNewer: !!chain?.getPaginationToken(Direction.Forward),
    };
    handles.stateRange = timeline.range;
    handles.rowRange = rowRange;
    handles.roomRowIds = roomRows.map((event) => event.getId());
    // The offset ledger: the rows a page mounts above the reader take their priced height, and
    // the reader's rows stay where they are.
    const foldPx = pendingRoomFoldPxRef.current;
    if (foldPx !== 0) {
      pendingRoomFoldPxRef.current = 0;
      scroller.element.scrollBy({ top: foldPx });
      handles.foldedPx += foldPx;
    }
  });
  useWindowHoldsWholeFolds({ timeline, stateRange, loadedRange, setTimeline });
  useWindowKeepsNewestRow({
    activeTimelineRange: loadedRange,
    eventId,
    roomRowCount: loaded.length,
    threadId: undefined,
    setTimeline,
  });
  const { paginator, pendingRoomFoldPxRef, roomFoldPriceRef, settledRoomPage } =
    useRoomWindowPaginator({
      alive: () => true,
      roomRows,
      roomRowsRef,
      activeTimelineRange: rowRange,
      activeRangeRef,
      loadedRangeOfRef,
      threadIdRef,
      firstRoomTimelineRef,
      lastRoomTimelineRef,
      scrollRef,
      setTimeline,
      paginateRoom,
      suppressFocusPaginationRef,
      windowLimit,
      getScrollElement: () => scroller.element,
      deferAutomaticPagination: () => false,
      readAhead: true,
    });
  useRetryAfterPageWithoutRows(settledRoomPage, roomRowsRef, paginator.retryPagination);
  // The ledger prices a row it has measured at that height: here every row is.
  useLayoutEffect(() => {
    roomFoldPriceRef.current = (_key, index) => {
      const row = roomRowsRef.current[activeRangeRef.current.start + index];
      return row ? scroller.rowPx(row) : 0;
    };
  });
  handles.setTimeline = setTimeline;
  handles.paginator = paginator;
  handles.toggle = (id) => {
    const state = folds.view.breaks.get(id);
    if (state) folds.toggle(state.fold);
  };
  return null;
}

const mountRoomWindow = (
  initialLoaded: MatrixEvent[],
  initialRange: ItemRange,
  options: Pick<RoomWindowProps, 'chain' | 'eventId' | 'paginateRoom'> & {
    windowLimit?: number;
  } = {}
) => {
  const scroller = fakeRoomScroller();
  const handles: Handles = { foldedPx: 0 };
  let renderer: ReactTestRenderer | undefined;
  const element = (loaded: MatrixEvent[]) =>
    createElement(RoomWindow, {
      loaded,
      initialRange,
      windowLimit: options.windowLimit ?? 50,
      eventId: options.eventId,
      chain: options.chain,
      paginateRoom: options.paginateRoom,
      scroller,
      handles,
    });
  act(() => {
    renderer = create(element(initialLoaded));
  });
  return {
    scroller,
    handles,
    windowIds: () => scroller.shown.current.rows.map((event) => event.getId()),
    /** One render with `loaded` rows and whatever `during` queues before it. */
    renderWith: (loaded: MatrixEvent[], during: () => void = () => undefined) =>
      act(() => {
        renderer?.update(element(loaded));
        during();
      }),
    unmount: () => act(() => renderer?.unmount()),
  };
};

describe('the room window paginator over a closed fold', () => {
  let room: ReturnType<typeof mountRoomWindow> | undefined;

  afterEach(() => {
    room?.unmount();
    room = undefined;
  });

  // Loaded rows: 30 messages, a run of 31 joins and 300 messages. As rows of the room: 331.
  const loaded = [...messages('a', 30), ...joins('j', 31), ...messages('b', 300)];
  const FOLD_END = 61;

  it("pages towards newer rows across the fold and keeps the reader's row where it is", () => {
    // The window: the 30 messages, the fold and 80 messages after it. Loaded rows 0 to 141.
    room = mountRoomWindow(loaded, { start: 0, end: FOLD_END + 80 }, { eventId: '$b40' });
    const { scroller, handles, windowIds } = room;
    expect(handles.rowRange).toEqual({ start: 0, end: 111 });
    expect(windowIds().slice(29, 32)).toEqual(['$a29', '$j0', '$b0']);

    // The reader, three screens below the fold, reaches the window's end: the front sentinel is
    // within a screen of the view.
    scroller.scrollTo(1 + 30 * MESSAGE_PX + BREAK_PX + 60 * MESSAGE_PX + 15);
    const readingAt = '$b60';
    expect(scroller.screenTop(readingAt)).toBe(-15);
    act(() => handles.paginator?.retryPagination());

    // The page widened the window by 50 rows and dropped the rows more than a screen above the
    // view: the 30 messages, the fold and the messages after it. Every row has an element, the
    // fold's too, so the first row in view was found and holds its place.
    expect(handles.rowRange?.end).toBe(161);
    expect(handles.rowRange?.start).toBeGreaterThan(31);
    expect(windowIds()).not.toContain('$j0');
    expect(scroller.screenTop(readingAt)).toBe(-15);
    // The state counts loaded rows: the fold's 31 are before its window.
    expect(handles.stateRange).toEqual({
      start: (handles.rowRange?.start ?? 0) + 30,
      end: 161 + 30,
    });
  });

  it('prices the fold once, as one row, when a page mounts it above the reader', () => {
    // The window starts 20 messages after the fold; the reader is at its top.
    room = mountRoomWindow(
      loaded,
      { start: FOLD_END + 20, end: FOLD_END + 120 },
      { eventId: '$b60', windowLimit: 30 }
    );
    const { scroller, handles, windowIds } = room;
    expect(handles.rowRange).toEqual({ start: 51, end: 151 });
    expect(windowIds()[0]).toBe('$b20');
    const readerTop = scroller.screenTop('$b20');
    act(() => handles.paginator?.retryPagination());

    // Thirty rows mount above: 20 messages, the fold and 9 messages before it. No window starts
    // inside the fold, so no break moves from one row to another, and none is priced at nothing.
    expect(handles.rowRange?.start).toBe(21);
    expect(windowIds().slice(0, 11)).toEqual([
      ...Array.from({ length: 9 }, (_, index) => `$a${index + 21}`),
      '$j0',
      '$b0',
    ]);
    expect(handles.foldedPx).toBe(29 * MESSAGE_PX + BREAK_PX);
    // What the ledger took is what the rows above the reader's row take in the list: it is
    // where it was.
    expect(scroller.screenTop('$b20')).toBe(readerTop);
    expect(handles.stateRange?.start).toBe(21);
  });

  it("keeps the rows after a fold at the window's end when it opens and closes", () => {
    const tail = [...messages('a', 10), ...joins('j', 5), ...messages('b', 2)];
    room = mountRoomWindow(tail, { start: 0, end: tail.length });
    const { handles, windowIds } = room;
    expect(windowIds().slice(-4)).toEqual(['$a9', '$j0', '$b0', '$b1']);
    act(() => handles.toggle?.('$j0'));
    expect(windowIds().slice(-8)).toEqual(['$a9', '$j0', '$j1', '$j2', '$j3', '$j4', '$b0', '$b1']);
    // The state's window is the same loaded rows: opening moved nothing in it.
    expect(handles.stateRange).toEqual({ start: 0, end: tail.length });
    act(() => handles.toggle?.('$j0'));
    expect(windowIds().slice(-4)).toEqual(['$a9', '$j0', '$b0', '$b1']);
    expect(handles.stateRange).toEqual({ start: 0, end: tail.length });
  });
});

describe('a page of history that brings earlier events of the fold the window starts with', () => {
  it('shows the fold whole, has the state follow, and asks for the next page', async () => {
    const chain = fakeTimeline('token-2');
    const started: (string | null)[] = [];
    const pending: (() => void)[] = [];
    let running: Promise<void> | undefined;
    const paginateRoom = () => {
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
    // The loaded rows start with three joins of a longer run: a short room, its back sentinel in
    // view.
    const first = [join('$m3'), join('$m4'), join('$m5'), ...messages('b', 5)];
    const room = mountRoomWindow(first, { start: 0, end: first.length }, { chain, paginateRoom });
    const { handles, windowIds } = room;
    expect(windowIds()).toEqual(['$m3', '$b0', '$b1', '$b2', '$b3', '$b4']);
    const shownBefore = handles.rowRange;
    act(() => handles.paginator?.retryPagination());
    expect(started).toEqual(['token-2']);

    // The page brings `$m1` and `$m2`. The state's window moves with the rows it held and now
    // starts at `$m3`, inside the fold.
    chain.setBackToken('token-1');
    room.renderWith([join('$m1'), join('$m2'), ...first], () =>
      handles.setTimeline?.((current) => ({
        ...current,
        range: { start: current.range.start + 2, end: current.range.end + 2 },
      }))
    );
    // The window shows the fold whole, at its new first event: the same rows of the room, so the
    // same window for the paginator and the ledger.
    expect(windowIds()).toEqual(['$m1', '$b0', '$b1', '$b2', '$b3', '$b4']);
    expect(handles.rowRange).toBe(shownBefore);
    // The state follows the window shown.
    expect(handles.stateRange).toEqual({ start: 0, end: first.length + 2 });

    // The page added no row to the room's rows and its sentinel is still in view: once it
    // settles, the next page loads.
    await act(async () => {
      pending.shift()?.();
      await running;
    });
    expect(started).toEqual(['token-2', 'token-1']);
    room.unmount();
  });
});

describe('a page of newer events that all go into the closed fold the rows end with', () => {
  it('asks for the next page once it settles, and not again after a page that failed', async () => {
    // A message link's window: it ends with the first three joins of a longer run, and newer
    // events wait at the server.
    const chain = fakeTimeline(null, 'newer-1');
    const started: (string | null)[] = [];
    const pending: (() => void)[] = [];
    let running: Promise<void> | undefined;
    const paginateRoom = (back: boolean) => {
      if (back) return Promise.resolve();
      if (!running) {
        started.push(chain.getPaginationToken(Direction.Forward));
        running = new Promise<void>((resolve) => {
          pending.push(resolve);
        }).finally(() => {
          running = undefined;
        });
      }
      return running;
    };
    const settle = () =>
      act(async () => {
        pending.shift()?.();
        await running;
      });
    const first = [...messages('a', 5), join('$m1'), join('$m2'), join('$m3')];
    const room = mountRoomWindow(
      first,
      { start: 0, end: first.length },
      { chain, paginateRoom, eventId: '$a2' }
    );
    const { handles, windowIds } = room;
    const shown = ['$a0', '$a1', '$a2', '$a3', '$a4', '$m1'];
    expect(windowIds()).toEqual(shown);
    const shownBefore = handles.rowRange;
    // A short room: the front sentinel is in view.
    act(() => handles.paginator?.retryPagination());
    expect(started).toEqual(['newer-1']);

    // The page brings `$m4` and `$m5`, which the fold takes: the room's rows are the same six,
    // and so is the window the paginator follows.
    chain.setForwardToken('newer-2');
    room.renderWith([...first, join('$m4'), join('$m5')]);
    expect(windowIds()).toEqual(shown);
    expect(handles.rowRange).toBe(shownBefore);
    // The state follows the fold shown whole.
    expect(handles.stateRange).toEqual({ start: 0, end: first.length + 2 });

    // Its sentinel is still in view: once the page settles, the next one loads.
    await settle();
    expect(started).toEqual(['newer-1', 'newer-2']);

    // That one fails and leaves its token: it is not asked for again by itself.
    await settle();
    expect(started).toEqual(['newer-1', 'newer-2']);
    room.unmount();
  });
});
