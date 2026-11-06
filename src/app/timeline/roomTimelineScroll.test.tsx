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
  useGestureBottomPins,
  useLatestRowPin,
  useRowsGeneration,
  useTimelineRowJumps,
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
};

/** The pieces of the room's Full view that decide its bottom pins, wired as the room timeline does. */
function RoomRows({ scroller, pins, rows, scrollToIndex }: RoomProps) {
  const scrollRef = useRef(scroller as unknown as HTMLDivElement);
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
          steps.push(`align row at ${row.getBoundingClientRect().top} ${opts?.behavior ?? ''}`);
          return true;
        },
        activeRangeRef: { current: { start: 0, end: 44 } },
        virtualizerRef: {
          current: { scrollToIndex: (index: number) => steps.push(`virtual list row ${index}`) },
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

  it('takes a far row through the virtual list, then aligns it until it keeps its place', () => {
    const { steps, state, scroller, runFrame, jumps } = setup();
    expect(jumps().scrollToItem(0, { behavior: 'smooth', align: 'center' })).toBe(true);
    expect(steps).toEqual(['ledger', 'ledger', 'virtual list row 0']);
    steps.length = 0;
    // The row mounts and moves twice while the rows around it measure, then holds still.
    for (const top of [180, 240, 280, 280, 280, 280]) {
      state.rowTop.set(0, top);
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
    expect(steps).toEqual(['ledger', 'virtual list row 4']);
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
