import { createElement, useReducer, useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  useRoomFocusScrollController,
  type ScrollToBottomState,
} from './roomFocusScrollController';
import { useThreadBackPaginationController } from './threadBackPaginationController';
import { useViewScopedFlag } from './roomTimelineViewScope';
import type { EventTimeline } from 'matrix-js-sdk';
import {
  heldListHeight,
  useGestureBottomPins,
  useLatestPinAsked,
  useLatestRowPin,
  useRowsGeneration,
  useThreadReturnPlace,
  useTimelineRowJumps,
  type RoomRowsPlace,
} from './roomTimelineScroll';
import type { ThreadTargetCommands } from '../threads/open/threadSessionTypes';

/** A thread's scroll area at its bottom: listeners by event type and a recorded `scrollTo`. */
const fakeThreadScroller = () => {
  const handlers = new Map<string, Set<() => void>>();
  const element = {
    scrollHeight: 3000,
    clientHeight: 600,
    scrollTop: 2400,
    scrollTo: vi.fn(),
    addEventListener: (type: string, handler: () => void) => {
      const forType = handlers.get(type) ?? new Set<() => void>();
      forType.add(handler);
      handlers.set(type, forType);
    },
    removeEventListener: (type: string, handler: () => void) => {
      handlers.get(type)?.delete(handler);
    },
  };
  const fire = (type: string) => handlers.get(type)?.forEach((handler) => handler());
  return { element, fire };
};

const noTargets: ThreadTargetCommands = {
  getPending: () => undefined,
  queue: () => undefined,
  complete: () => undefined,
  discard: () => undefined,
  advanceAttempt: () => undefined,
  wakeRetry: () => undefined,
};

type ThreadProps = {
  scroller: ReturnType<typeof fakeThreadScroller>['element'];
  pins: { current: ScrollToBottomState };
  rows: number;
  openPending: boolean;
  /** Whether the request that keeps the newest row in view takes over once the reader scrolls. */
  followsLatest?: boolean;
};

const ignoreRowIndex = () => undefined;

/** The pieces of an open thread that decide its bottom pins, wired as the room timeline does. */
function OpenThread({ scroller, pins, rows, openPending, followsLatest = false }: ThreadProps) {
  const scrollRef = useRef(scroller as unknown as HTMLDivElement);
  const backController = useThreadBackPaginationController();
  const readerScrolledRef = useViewScopedFlag('!room|$thread');
  const [, rerender] = useReducer((value: number) => value + 1, 0);
  const gesturePins = useGestureBottomPins({
    backController,
    scrollToBottomRef: pins,
    readerScrolledRef,
    onFirstGesture: rerender,
  });
  useRoomFocusScrollController({
    alive: () => true,
    atBottomAnchorRef: { current: null },
    focusScrollResetToken: '!room',
    threadTargets: noTargets,
    pendingThreadOpenTick: 0,
    retryPagination: () => undefined,
    roomId: '!room',
    scrollRef,
    scrollToBottomRef: pins,
    scrollToElement: () => false,
    scrollToItem: () => false,
    setAtBottom: () => undefined,
    setFocusItem: () => undefined,
    suppressFocusPaginationRef: { current: false },
    isThreadOpenBottomPinSuppressed: backController.isOpenBottomPinSuppressed,
    requestThreadOpenBottomPin: () => backController.requestOpenBottomPin(pins),
    cancelThreadOpenBottomPin: gesturePins.onThreadGesture,
    shouldApplyThreadBottomPin: gesturePins.shouldApplyBottomPin,
    threadEventIndexMapRef: { current: new Map() },
    threadEventsLength: rows,
    threadFilteredEvents: [],
    threadFilteredEventsRef: { current: [] },
    threadId: '$thread',
    threadInitialRenderMode: 'live',
    threadLatestOpenPending: openPending,
    threadOpenedAtLatest: true,
    threadUserScrolled: readerScrolledRef.current.value,
    threadTimelineTick: 0,
    timelineAtLiveEnd: true,
  });
  useLatestRowPin({
    surface: followsLatest && readerScrolledRef.current.value ? 'thread' : undefined,
    itemCount: rows,
    virtualizer: { scrollToIndex: ignoreRowIndex },
    opensAtLatest: true,
    roomId: '!room',
    scrollElement: scroller as unknown as HTMLElement,
    scrollToBottomRef: pins,
    committedView: '!room|$thread|threaded',
    focusItem: undefined,
    onReaderGesture: gesturePins.onRoomGesture,
  });
  return null;
}

/** A thread opened at its newest row, the opening done, the reader still at the bottom. */
const openAtLatest = (followsLatest = false) => {
  const { element, fire } = fakeThreadScroller();
  const pins = { current: { count: 0, smooth: false } };
  const render = (rows: number, openPending: boolean) =>
    createElement(OpenThread, { scroller: element, pins, rows, openPending, followsLatest });
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(render(20, true));
  });
  if (!renderer) throw new Error('Expected a renderer');
  const shown = renderer;
  act(() => {
    shown.update(render(20, false));
  });
  expect(element.scrollTo).toHaveBeenCalled();
  element.scrollTo.mockClear();
  const showRows = (rows: number) =>
    act(() => {
      shown.update(render(rows, false));
    });
  // What the live row handling does for a row that arrives while the reader is at the bottom.
  const followNewRow = () => {
    pins.current.count += 1;
  };
  return { element, fire, pins, showRows, followNewRow };
};

describe('useGestureBottomPins in an open thread', () => {
  it('drops a follow pin a row asked for when the reader touches before it is applied', () => {
    const thread = openAtLatest();

    thread.followNewRow();
    // The reader's finger lands before the commit that shows the new row.
    act(() => thread.fire('touchstart'));
    thread.showRows(21);

    expect(thread.element.scrollTo).not.toHaveBeenCalled();
  });

  it('drops a pin queued before a later gesture of a reader who already scrolled', () => {
    const thread = openAtLatest();
    act(() => thread.fire('touchstart'));
    thread.showRows(20);

    thread.followNewRow();
    act(() => thread.fire('wheel'));
    thread.showRows(21);

    expect(thread.element.scrollTo).not.toHaveBeenCalled();
  });

  it('still follows a row that asks after the gesture', () => {
    const thread = openAtLatest();
    act(() => thread.fire('touchstart'));
    thread.showRows(20);

    thread.followNewRow();
    thread.showRows(21);

    expect(thread.element.scrollTo).toHaveBeenCalledTimes(1);
    expect(thread.element.scrollTo).toHaveBeenCalledWith({ top: 2400, behavior: 'instant' });
  });
});

/**
 * A room's scroll area showing its newest rows at the bottom: listeners by event type (the capture
 * flag is not modelled) and a recorded `scrollTo`.
 */
const fakeRoomScroller = () => {
  const handlers = new Map<string, Set<() => void>>();
  const element = {
    scrollHeight: 3000,
    clientHeight: 600,
    scrollTop: 2400,
    scrollTo: vi.fn(),
    addEventListener: (type: string, handler: () => void) => {
      const forType = handlers.get(type) ?? new Set<() => void>();
      forType.add(handler);
      handlers.set(type, forType);
    },
    removeEventListener: (type: string, handler: () => void) => {
      handlers.get(type)?.delete(handler);
    },
  };
  const fire = (type: string) => handlers.get(type)?.forEach((handler) => handler());
  return { element, fire };
};

type RoomProps = {
  scroller: ReturnType<typeof fakeRoomScroller>['element'];
  pins: { current: ScrollToBottomState };
  rows: number;
  scrollToIndex: (index: number) => void;
  /** The rows run newest first (the Threads view under a newest-first sort). */
  latestAtTop?: boolean;
};

/** The pieces of the room's Full view that decide its bottom pins, wired as the room timeline does. */
function RoomRows({ scroller, pins, rows, scrollToIndex, latestAtTop = false }: RoomProps) {
  const scrollRef = useRef(scroller as unknown as HTMLDivElement);
  const latestAtTopRef = useRef(latestAtTop);
  latestAtTopRef.current = latestAtTop;
  const backController = useThreadBackPaginationController();
  const readerScrolledRef = useViewScopedFlag('!room|');
  const gesturePins = useGestureBottomPins({
    backController,
    scrollToBottomRef: pins,
    readerScrolledRef,
    onFirstGesture: () => undefined,
  });
  useRoomFocusScrollController({
    alive: () => true,
    atBottomAnchorRef: { current: null },
    focusScrollResetToken: '!room',
    latestAtTopRef,
    threadTargets: noTargets,
    pendingThreadOpenTick: 0,
    retryPagination: () => undefined,
    roomId: '!room',
    scrollRef,
    scrollToBottomRef: pins,
    scrollToElement: () => false,
    scrollToItem: () => false,
    setAtBottom: () => undefined,
    setFocusItem: () => undefined,
    suppressFocusPaginationRef: { current: false },
    isThreadOpenBottomPinSuppressed: backController.isOpenBottomPinSuppressed,
    requestThreadOpenBottomPin: () => backController.requestOpenBottomPin(pins),
    cancelThreadOpenBottomPin: gesturePins.onThreadGesture,
    shouldApplyThreadBottomPin: gesturePins.shouldApplyBottomPin,
    threadEventIndexMapRef: { current: new Map() },
    threadEventsLength: 0,
    threadFilteredEvents: [],
    threadFilteredEventsRef: { current: [] },
    threadInitialRenderMode: 'live',
    threadLatestOpenPending: false,
    threadOpenedAtLatest: false,
    threadUserScrolled: false,
    threadTimelineTick: 0,
    timelineAtLiveEnd: true,
  });
  useLatestRowPin({
    surface: 'room',
    itemCount: rows,
    virtualizer: { scrollToIndex },
    opensAtLatest: true,
    latestAtTop,
    roomId: '!room',
    scrollElement: scroller as unknown as HTMLElement,
    scrollToBottomRef: pins,
    committedView: '!room||classic',
    focusItem: undefined,
    onReaderGesture: gesturePins.onRoomGesture,
  });
  return null;
}

/** A room opened at its newest row, the reader still at the bottom. */
const roomAtLatest = () => {
  const { element, fire } = fakeRoomScroller();
  const pins = { current: { count: 0, smooth: false } };
  const scrollToIndex = vi.fn();
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(
      createElement(RoomRows, { scroller: element, pins, rows: 20, scrollToIndex })
    );
  });
  if (!renderer) throw new Error('Expected a renderer');
  const shown = renderer;
  expect(scrollToIndex).toHaveBeenCalledWith(19, { align: 'end' });
  scrollToIndex.mockClear();
  element.scrollTo.mockClear();
  const showRows = (rows: number) =>
    act(() => {
      shown.update(createElement(RoomRows, { scroller: element, pins, rows, scrollToIndex }));
    });
  // What the live row handling does for a row that arrives while the reader is at the bottom.
  const followNewRow = () => {
    pins.current.count += 1;
    pins.current.smooth = true;
  };
  // The reader drags the scrollbar or a flick coasts on: a scroll up with no touch or wheel event.
  const scrollUp = (px: number) => {
    element.scrollTop -= px;
    act(() => fire('scroll'));
  };
  /** Whether anything moved the reader to the bottom: the room's own pin or the shared one. */
  const pinned = () => scrollToIndex.mock.calls.length + element.scrollTo.mock.calls.length;
  return { fire, showRows, followNewRow, scrollUp, pinned, scrollToIndex, element };
};

describe('useGestureBottomPins in the room rows', () => {
  it('drops a follow pin a row asked for when the reader scrolls up before it is applied', () => {
    const room = roomAtLatest();

    room.followNewRow();
    // A scroll up that leaves more rows below, before the commit that shows the new row.
    room.scrollUp(80);
    room.showRows(21);
    room.showRows(21);

    expect(room.pinned()).toBe(0);
  });

  it('drops a follow pin when the reader touches before it is applied', () => {
    const room = roomAtLatest();

    room.followNewRow();
    act(() => room.fire('touchstart'));
    room.showRows(21);

    expect(room.pinned()).toBe(0);
  });

  it('still follows a row that asks after the gesture', () => {
    const room = roomAtLatest();
    act(() => room.fire('touchstart'));
    room.showRows(20);

    room.followNewRow();
    room.showRows(21);

    expect(room.scrollToIndex).toHaveBeenCalledWith(20, { align: 'end' });
    expect(room.element.scrollTo).toHaveBeenCalledWith({ top: 2400, behavior: 'smooth' });
  });
});

describe('useLatestRowPin and the virtual list', () => {
  /**
   * The room's rows at their newest row, with a virtual list that keeps the scroll it was last
   * asked for (virtual-core's `scrollState`) until it lands there.
   */
  const pinnedList = (pendingListShrinkPx?: () => number) => {
    const { element, fire } = fakeRoomScroller();
    const list = {
      scrollState: null as { index: number } | null,
      scrollToIndex: (index: number) => {
        list.scrollState = { index };
      },
    };
    function Pin() {
      useLatestRowPin({
        surface: 'room',
        itemCount: 20,
        virtualizer: list,
        opensAtLatest: true,
        roomId: '!room',
        scrollElement: element as unknown as HTMLElement,
        scrollToBottomRef: { current: { count: 0, smooth: false } },
        committedView: '!room||classic',
        focusItem: undefined,
        onReaderGesture: () => undefined,
        pendingListShrinkPx,
      });
      return null;
    }
    act(() => {
      create(createElement(Pin));
    });
    expect(list.scrollState).toEqual({ index: 19 });
    return { element, fire, list };
  };

  it("ends the list's scroll to the newest row at the reader's wheel, touch, pointer or key", () => {
    (['wheel', 'touchstart', 'pointerdown', 'keydown'] as const).forEach((gesture) => {
      const room = pinnedList();
      act(() => room.fire(gesture));
      expect(room.list.scrollState).toBeNull();
    });
  });

  it('ends it when the reader drags the scrollbar up', () => {
    const room = pinnedList();
    room.element.scrollTop -= 200;
    act(() => room.fire('scroll'));
    expect(room.list.scrollState).toBeNull();
  });

  it('keeps it when rows that shrank move the position up before the list renders its end', () => {
    // A narrower panel closes: the rows near the end shrink by 220 px, the timeline's correction
    // keeps the end in place, and the list still holds their room until React renders it.
    let shrinkNotRendered = 0;
    const room = pinnedList(() => shrinkNotRendered);
    shrinkNotRendered = 220;
    room.element.scrollTop -= 220;
    act(() => room.fire('scroll'));
    expect(room.list.scrollState).toEqual({ index: 19 });

    // React renders the list at its new height, which fires no scroll; the reader's own scroll
    // up from there still ends it.
    room.element.scrollHeight -= 220;
    shrinkNotRendered = 0;
    room.element.scrollTop -= 200;
    act(() => room.fire('scroll'));
    expect(room.list.scrollState).toBeNull();
  });

  it('keeps it when the scroll area grows and the browser moves the position up as much', () => {
    // A phone held sideways with its keyboard up: Safari widens the band above the keyboard by
    // 28 px while the rows measure again at the new width. The browser keeps the position inside
    // the taller area by moving it up 28 px, and by that scroll event the rows have grown 258 px.
    const room = pinnedList();
    room.element.clientHeight += 28;
    room.element.scrollTop -= 28;
    room.element.scrollHeight += 258;
    act(() => room.fire('scroll'));
    expect(room.list.scrollState).toEqual({ index: 19 });

    // A scroll up from there moves the view's lower edge: the reader's.
    room.element.scrollTop -= 200;
    act(() => room.fire('scroll'));
    expect(room.list.scrollState).toBeNull();
  });

  it('never counts less than no room below when the list has rendered the shrink', () => {
    // macOS Chromium: React has rendered the list 120 px shorter, but its rows still measure a
    // 120 px shrink for a scroll event; the next correction then moves the position up by 120.
    let shrinkNotRendered = 120;
    const room = pinnedList(() => shrinkNotRendered);
    act(() => room.fire('scroll'));
    shrinkNotRendered = 0;
    room.element.scrollTop -= 120;
    room.element.scrollHeight -= 120;
    act(() => room.fire('scroll'));
    expect(room.list.scrollState).toEqual({ index: 19 });
  });
});

describe('useLatestRowPin in room rows that run newest first', () => {
  /** The Threads view under a newest-first sort, opened at its top. */
  const roomNewestFirst = () => {
    const { element, fire } = fakeRoomScroller();
    element.scrollTop = 0;
    const pins = { current: { count: 0, smooth: false } };
    const scrollToIndex = vi.fn();
    let renderer: ReactTestRenderer | undefined;
    const props = { scroller: element, pins, scrollToIndex, latestAtTop: true };
    act(() => {
      renderer = create(createElement(RoomRows, { ...props, rows: 20 }));
    });
    if (!renderer) throw new Error('Expected a renderer');
    const shown = renderer;
    const showRows = (rows: number) =>
      act(() => {
        shown.update(createElement(RoomRows, { ...props, rows }));
      });
    return { element, fire, pins, scrollToIndex, showRows };
  };

  it('opens at the top and keeps it while rows land there, until the reader scrolls down', () => {
    const room = roomNewestFirst();
    expect(room.element.scrollTo).toHaveBeenCalledWith({ top: 0 });
    room.element.scrollTo.mockClear();

    room.showRows(21);
    expect(room.element.scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(room.scrollToIndex).not.toHaveBeenCalled();

    // The scrollbar or a script takes the reader down, with no touch or wheel event.
    room.element.scrollTop = 120;
    act(() => room.fire('scroll'));
    room.element.scrollTo.mockClear();
    room.showRows(22);
    expect(room.element.scrollTo).not.toHaveBeenCalled();
  });

  it('follows a new row at the top, and Jump to Latest goes there', () => {
    const room = roomNewestFirst();
    act(() => room.fire('touchstart'));
    room.element.scrollTo.mockClear();

    room.pins.current = { count: room.pins.current.count + 1, smooth: true };
    room.showRows(21);

    expect(room.element.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(room.scrollToIndex).not.toHaveBeenCalled();
  });
});

describe('useLatestRowPin in an open thread the reader has scrolled', () => {
  /** The reader scrolled the thread and is back at its bottom. */
  const scrolledThread = () => {
    const thread = openAtLatest(true);
    act(() => thread.fire('wheel'));
    thread.showRows(20);
    return thread;
  };

  it('leaves the pins the thread opened with behind', () => {
    const thread = scrolledThread();

    thread.element.scrollHeight = 3200;
    thread.showRows(21);

    expect(thread.element.scrollTo).not.toHaveBeenCalled();
  });

  it('keeps the bottom after a send while the rows below grow, until the reader scrolls', () => {
    const thread = scrolledThread();

    // The reader sends at the bottom: the local echo asks once, with a smooth scroll.
    thread.pins.current.count += 1;
    thread.pins.current.smooth = true;
    thread.showRows(21);
    expect(thread.element.scrollTo).toHaveBeenLastCalledWith({ top: 2400, behavior: 'instant' });

    // The timeline's next scroll write cut the smooth scroll short, and a reply streams in below
    // without asking again.
    thread.element.scrollTop = 2340;
    thread.element.scrollHeight = 3200;
    thread.element.scrollTo.mockClear();
    thread.showRows(22);
    expect(thread.element.scrollTo).toHaveBeenCalledWith({ top: 2600, behavior: 'instant' });

    // The reader's own gesture hands the position back.
    act(() => thread.fire('wheel'));
    thread.element.scrollTo.mockClear();
    thread.element.scrollHeight = 3400;
    thread.showRows(23);
    expect(thread.element.scrollTo).not.toHaveBeenCalled();
  });
});

describe('useTimelineRowJumps', () => {
  /** A box at a vertical position, as getBoundingClientRect answers it. */
  const box = (top: number, height = 40) => ({ top, bottom: top + height, height });

  /** A scroll area 600 px tall that records the listeners a jump adds. */
  const fakeRoomScroller = () => {
    const listeners = new Map<string, Set<() => void>>();
    return {
      scrollTop: 0,
      getBoundingClientRect: () => box(0, 600),
      addEventListener: (type: string, handler: () => void) => {
        const forType = listeners.get(type) ?? new Set<() => void>();
        forType.add(handler);
        listeners.set(type, forType);
      },
      removeEventListener: (type: string, handler: () => void) => {
        listeners.get(type)?.delete(handler);
      },
      fire: (type: string) => listeners.get(type)?.forEach((handler) => handler()),
      listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    };
  };

  type Setup = {
    rowTop: Map<number, number>;
    rows: { current: { getId: () => string | undefined }[] };
  };

  /** The jumps of a room whose 44 rows are all in the window; `rowTop` says which are mounted. */
  const setup = () => {
    const steps: string[] = [];
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback));
    const scroller = fakeRoomScroller();
    const state: Setup = {
      rowTop: new Map(),
      rows: {
        current: Array.from({ length: 44 }, (_, index) => ({ getId: () => `$row${index}` })),
      },
    };
    const element = (index: number) =>
      ({ getBoundingClientRect: () => box(state.rowTop.get(index) ?? 0) } as HTMLElement);
    let jumps: ReturnType<typeof useTimelineRowJumps> | undefined;
    function Jumps() {
      jumps = useTimelineRowJumps({
        paginatorScrollToItem: (index, opts) => {
          steps.push(`paginator row ${index} ${opts?.behavior ?? ''}`.trim());
          return true;
        },
        paginatorScrollToElement: (row, opts) => {
          const offset = opts?.offset === undefined ? '' : ` offset ${opts.offset}`;
          steps.push(
            `align row at ${row.getBoundingClientRect().top} ${opts?.behavior ?? ''}${offset}`
          );
          return true;
        },
        activeRangeRef: { current: { start: 0, end: 44 } },
        virtualizerRef: {
          current: {
            scrollToIndex: (index: number) => steps.push(`virtual list row ${index}`),
            // The list places row n at n * 100.
            getOffsetForIndex: (index: number) => [index * 100, 'center'] as const,
          },
        },
        threadEventIndexMapRef: { current: new Map([['$reply', 3]]) },
        onJump: () => steps.push('ledger'),
        rows: {
          getScrollElement: () => scroller as unknown as HTMLElement,
          getRowElement: (index) => (state.rowTop.has(index) ? element(index) : undefined),
          roomRowsRef: state.rows,
        },
      });
      return null;
    }
    act(() => {
      create(createElement(Jumps));
    });
    const runFrame = () => frames.splice(0).forEach((callback) => callback());
    return { steps, state, scroller, runFrame, jumps: () => jumps! };
  };

  it('scrolls a row near the view with the paginator, smooth when asked', () => {
    const { steps, state, jumps } = setup();
    state.rowTop.set(40, 700);
    expect(jumps().scrollToItem(40, { behavior: 'smooth' })).toBe(true);
    expect(steps).toEqual(['ledger', 'paginator row 40 smooth']);
    vi.unstubAllGlobals();
  });

  it('aligns a near row a smooth scroll left out of view once the scrolling stops', () => {
    const { steps, state, scroller, runFrame, jumps } = setup();
    state.rowTop.set(40, 700);
    jumps().scrollToItem(40, { behavior: 'smooth', align: 'center' });
    steps.length = 0;
    // The smooth scroll moves for two frames, then stops with the row still below the view.
    for (const top of [100, 200, 200, 200, 200]) {
      scroller.scrollTop = top;
      runFrame();
    }
    expect(steps.filter((step) => step.startsWith('align'))).toEqual(['align row at 700 instant']);
    vi.unstubAllGlobals();
  });

  it('leaves a near row a smooth scroll brought into view alone', () => {
    const { steps, state, scroller, runFrame, jumps } = setup();
    state.rowTop.set(40, 700);
    jumps().scrollToItem(40, { behavior: 'smooth', align: 'center' });
    state.rowTop.set(40, 280);
    for (let frame = 0; frame < 6; frame += 1) runFrame();
    expect(steps).toEqual(['ledger', 'paginator row 40 smooth']);
    expect(scroller.listenerCount()).toBe(0);
    vi.unstubAllGlobals();
  });

  it('takes a far row to its place in the list, then aligns it until it keeps its place', () => {
    const { steps, state, scroller, runFrame, jumps } = setup();
    scroller.scrollTop = 2400;
    expect(jumps().scrollToItem(7, { behavior: 'smooth', align: 'center' })).toBe(true);
    // Not through the list's scrollToIndex, which would scroll there again later.
    expect(steps).toEqual(['ledger', 'ledger']);
    expect(scroller.scrollTop).toBe(700);
    steps.length = 0;
    // The row mounts and moves twice while the rows around it measure, then holds still.
    for (const top of [180, 240, 280, 280, 280, 280]) {
      state.rowTop.set(7, top);
      runFrame();
    }
    expect(steps.filter((step) => step.startsWith('align'))).toEqual([
      'align row at 180 instant',
      'align row at 240 instant',
      'align row at 280 instant',
      'align row at 280 instant',
      'align row at 280 instant',
      'align row at 280 instant',
    ]);
    runFrame();
    expect(steps.filter((step) => step.startsWith('align'))).toHaveLength(6);
    expect(scroller.listenerCount()).toBe(0);
    vi.unstubAllGlobals();
  });

  it('aligns a far row at the offset the jump asks for', () => {
    const { steps, state, runFrame, jumps } = setup();
    jumps().scrollToItem(0, { align: 'start', offset: -72 });
    state.rowTop.set(0, 180);
    runFrame();
    expect(steps.filter((step) => step.startsWith('align'))).toEqual([
      'align row at 180 instant offset -72',
    ]);
    vi.unstubAllGlobals();
  });

  it('follows the event when rows load above it, and stops when the reader scrolls', () => {
    const { steps, state, scroller, runFrame, jumps } = setup();
    jumps().scrollToItem(2);
    steps.length = 0;
    // Two older rows arrive above: the target is row 4 now.
    state.rows.current = [
      { getId: () => '$older1' },
      { getId: () => '$older2' },
      ...state.rows.current,
    ];
    runFrame();
    expect(steps).toEqual(['ledger']);
    expect(scroller.scrollTop).toBe(400);
    scroller.fire('wheel');
    steps.length = 0;
    runFrame();
    expect(steps).toEqual([]);
    expect(scroller.listenerCount()).toBe(0);
    vi.unstubAllGlobals();
  });

  it('tells the ledger before every jump to a row', () => {
    const { steps, jumps } = setup();
    jumps().scrollToElement({ getBoundingClientRect: () => box(5) } as HTMLElement);
    jumps().scrollThreadEventIntoView('$reply');
    expect(steps).toEqual(['ledger', 'align row at 5 ', 'ledger', 'virtual list row 3']);
    vi.unstubAllGlobals();
  });
});

describe('useRowsGeneration', () => {
  it('counts the times the rows on screen are replaced, not the times the chain grows', () => {
    const part = (name: string) => ({ name } as unknown as EventTimeline);
    const [live, older, context] = [part('live'), part('older'), part('context')];
    const counts: number[] = [];
    function Rows({ chain }: { chain: EventTimeline[] }) {
      counts.push(useRowsGeneration(chain));
      return null;
    }
    let renderer: ReactTestRenderer | undefined;
    const show = (chain: EventTimeline[]) =>
      act(() => {
        if (renderer) renderer.update(createElement(Rows, { chain }));
        else renderer = create(createElement(Rows, { chain }));
      });

    show([live]);
    show([older, live]);
    // An event the room has not loaded: the rows empty, then the history around it arrives,
    // and its newer history joins the live chain.
    show([]);
    show([context]);
    show([context, live]);
    expect(counts).toEqual([0, 0, 1, 2, 2]);
  });
});

describe('useThreadReturnPlace', () => {
  /**
   * The Threads view, newest first, scrolled down: a scroll area 600 px tall, 100 px below the
   * window's top, with a row that ended above it, one that runs under its top edge and one below.
   */
  const scrolledRoomRows = (scrollTop = 900) => {
    const row = (eventId: string, top: number) => ({
      getAttribute: () => eventId,
      getBoundingClientRect: () => ({ top, bottom: top + 80 }),
    });
    return {
      scrollTop,
      scrollHeight: 9000,
      clientHeight: 600,
      getBoundingClientRect: () => ({ top: 100 }),
      querySelectorAll: () => [row('$second', 170), row('$above', 10), row('$first', 90)],
    } as unknown as HTMLElement;
  };
  type View = { threadId?: string; eventId?: string; compact?: boolean };
  /**
   * Shows the views one after another. Each mounts the timeline anew, as the approvals provider's
   * key does when a thread opens or closes; the room view's memory outlives them.
   */
  const showViews = (scroller: HTMLElement, views: View[]) => {
    const memoryRef: { current: RoomRowsPlace | undefined } = { current: undefined };
    const places: unknown[] = [];
    function Room({ threadId, eventId, compact }: View) {
      const scrollRef = useRef<HTMLElement | null>(scroller);
      places.push(
        useThreadReturnPlace({
          memoryRef,
          roomId: '!room',
          threadId,
          eventId,
          roomRowsShown: !threadId && !compact,
          latestAtTop: true,
          scrollRef,
        })
      );
      return null;
    }
    let renderer: ReactTestRenderer | undefined;
    views.forEach((view, index) => {
      const element = createElement(Room, { key: index, ...view });
      act(() => {
        if (renderer) renderer.update(element);
        else renderer = create(element);
      });
    });
    return { places, memoryRef };
  };
  const place = { roomId: '!room', eventId: '$first', offset: -10 };

  it('brings the rows back to the row at the top of the view when the thread closes', () => {
    const { places, memoryRef } = showViews(scrolledRoomRows(), [{}, { threadId: '$t' }, {}]);
    expect(places).toEqual([undefined, undefined, place]);
    expect(memoryRef.current).toBeUndefined();
  });

  it('keeps the place while the reader moves from thread to thread', () => {
    const views = [{}, { threadId: '$t' }, { threadId: '$u' }, {}];
    expect(showViews(scrolledRoomRows(), views).places[3]).toEqual(place);
  });

  it('keeps none for a reader at the latest end, a route to an event or Compact', () => {
    expect(showViews(scrolledRoomRows(0), [{}, { threadId: '$t' }, {}]).places[2]).toBeUndefined();
    const toEvent = [{}, { threadId: '$t' }, { eventId: '$t' }];
    expect(showViews(scrolledRoomRows(), toEvent).places[2]).toBeUndefined();
    const viaCompact = [{}, { threadId: '$t' }, { compact: true }, {}];
    expect(showViews(scrolledRoomRows(), viaCompact).places.slice(2)).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe('useLatestPinAsked', () => {
  it('is true only in the render that a bottom pin asked for since the last commit', () => {
    const asked: boolean[] = [];
    const pins: { current: ScrollToBottomState } = { current: { count: 0, smooth: false } };
    function Rows({ step }: { step: number }) {
      asked.push(useLatestPinAsked(pins));
      return step;
    }
    let renderer: ReactTestRenderer | undefined;
    const show = (step: number) =>
      act(() => {
        if (renderer) renderer.update(createElement(Rows, { step }));
        else renderer = create(createElement(Rows, { step }));
      });

    show(0);
    show(1);
    // Jump to Latest: the pin comes with the render of the newest rows.
    pins.current = { count: 1, smooth: false };
    show(2);
    // The next render, a page or a measurement, asks for nothing new.
    show(3);
    expect(asked).toEqual([false, false, true, false]);
  });
});

describe('heldListHeight', () => {
  // A scroll correction renders inside the browser's ResizeObserver loop: the scroll content, which
  // the scrollbar and the follow-growth observer watch, must keep its size there. The list's box
  // ends at its top margin plus its height.
  it('keeps the list bottom edge when the ledger moves the list top', () => {
    // As traced in WebKit: a 2273 px list without margin, and the ledger takes 285 px.
    const height = heldListHeight({ height: '2273px', marginTop: '' }, 285);
    expect(-285 + height).toBe(2273);
  });

  it('keeps the height when the ledger stays', () => {
    expect(heldListHeight({ height: '2000.5px', marginTop: '-100px' }, 100)).toBe(2000.5);
  });

  it('keeps the bottom edge when the ledger gives pixels back', () => {
    expect(0 + heldListHeight({ height: '2000px', marginTop: '-100px' }, 0)).toBe(-100 + 2000);
  });
});
