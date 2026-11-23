import React, { useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useTimelineScrollLedgerController,
  type TimelineScrollLedgerController,
} from './timelineScrollLedgerController';
import { STATUS_BAR_SCROLL_TOP_EVENT } from '../native/statusBarTapScroll';

const virtualizer = vi.hoisted(() => ({
  itemSizeCache: new Map<string, number>(),
  options: { scrollMargin: 0 },
  scrollOffset: 129,
  setOptions: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the types do not check without it
  shouldAdjustScrollPositionOnItemSizeChange: undefined as unknown,
  getVirtualItemForOffset: (offset: number) => {
    const index = Math.max(0, Math.floor(offset / 35));
    return { index, start: index * 35 };
  },
  getVirtualItems: () => [],
}));

const quiescenceResolvers = vi.hoisted(() => [] as (() => void)[]);

vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: () => virtualizer }));

vi.mock('./rideTraceRecorder', () => ({
  installRideTraceRecorder: vi.fn(),
  isRideTraceEnabled: () => false,
}));

// The wait for rest stays pending unless a test explicitly flushes it.
vi.mock('./scrollQuiescence', () => ({
  hasActiveWindowTouches: () => false,
  isIOSWebKitDevice: () => false,
  waitForScrollQuiescence: () =>
    new Promise<void>((resolve) => {
      quiescenceResolvers.push(resolve);
    }),
}));

type Correction = (
  item: { end: number },
  delta: number,
  instance: {
    scrollOffset: number | null;
    scrollDirection: 'forward' | 'backward' | null;
    scrollElement: { scrollTop: number };
  }
) => boolean;

/**
 * A room's scroll area, 704 px tall over 1663 px of rows, read 129 px down: the newest rows of a
 * window that just mounted older rows above them, as the Full view does when Jump to Time opens it.
 */
const mountRoomLedger = ({ settle = true } = {}) => {
  let scrollTop = 129;
  // Changes when the room's rows are replaced rather than added to.
  let rowsKey = 0;
  const writes: number[] = [];
  virtualizer.scrollOffset = scrollTop;
  virtualizer.options = { scrollMargin: 0 };
  let onScroll: (() => void) | undefined;
  let onStatusBarScrollTop: ((event: Event) => void) | undefined;
  const scrollArea = {
    clientHeight: 704,
    scrollHeight: 1663,
    getBoundingClientRect: () => ({ top: 0, bottom: 704 }),
    addEventListener: (type: string, listener: (event: Event) => void) => {
      if (type === 'scroll') onScroll = listener as () => void;
      if (type === STATUS_BAR_SCROLL_TOP_EVENT) onStatusBarScrollTop = listener;
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => {
      if (type === 'scroll' && onScroll === (listener as () => void)) onScroll = undefined;
      if (type === STATUS_BAR_SCROLL_TOP_EVENT && onStatusBarScrollTop === listener) {
        onStatusBarScrollTop = undefined;
      }
    },
    scrollTo: vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === 'object' && options.top !== undefined) {
        scrollArea.scrollTop = options.top;
      }
    }),
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(value: number) {
      writes.push(value);
      scrollTop = value;
    },
  };
  // The rows end above the area's bottom while the ledger pulls them up by its margin.
  const rows = {
    style: { marginTop: '' },
    getBoundingClientRect: () => ({ top: -800, bottom: 600 }),
  };
  let controller: TimelineScrollLedgerController | undefined;
  function Ledger() {
    controller = useTimelineScrollLedgerController({
      alive: () => true,
      estimateSize: () => 35,
      getItemKey: (index) => index,
      getScrollElement: () => scrollArea as unknown as HTMLDivElement,
      itemCount: 44,
      pendingRoomFoldPxRef: useRef(0),
      roomFoldPriceRef: useRef(() => 35),
      roomId: '!logbook:example.org',
      rowsKey,
      threadEventIndexMap: new Map(),
      threadEvents: [],
      threadInitialRenderMode: 'live',
    });
    return React.createElement('rows', { ref: controller.virtualInnerRef });
  }
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(React.createElement(Ledger), { createNodeMock: () => rows });
  });
  const correction = virtualizer.shouldAdjustScrollPositionOnItemSizeChange as Correction;
  // Rows that mounted above the reader while the view moved up: the ledger takes their 830 px.
  act(() => {
    expect(
      correction({ end: 50 }, 830, {
        scrollOffset: 129,
        scrollDirection: 'backward',
        scrollElement: scrollArea,
      })
    ).toBe(false);
  });
  expect(rows.style.marginTop).toBe('-830px');
  if (settle) {
    // The next scroll event settles that fold at once: the rows keep their place on screen.
    act(() => onScroll?.());
    expect(writes).toEqual([959]);
    expect(rows.style.marginTop).toBe('');
  }
  /** The view lands at `top` in one scroll event, as a jump does and a discarded write would. */
  const scrollTo = (top: number) =>
    act(() => {
      scrollTop = top;
      onScroll?.();
    });
  /**
   * virtual-core applies a correction for a row above the reader that changed by `delta`, and
   * writes the position it moves the view to, as its `applyScrollAdjustment` does.
   */
  const applyCorrection = (delta: number) => {
    let applied = false;
    act(() => {
      applied = correction({ end: 50 }, delta, {
        scrollOffset: scrollTop,
        scrollDirection: 'forward',
        scrollElement: scrollArea,
      });
    });
    if (applied) scrollTo(scrollTop + delta);
    return applied;
  };
  const statusBarScrollTop = () => {
    const event = new Event(STATUS_BAR_SCROLL_TOP_EVENT, { cancelable: true });
    act(() => {
      onStatusBarScrollTop?.(event);
    });
    return event;
  };
  const flushQuiescence = async (count = quiescenceResolvers.length) => {
    await act(async () => {
      const pending = quiescenceResolvers.splice(0, count);
      pending.forEach((resolve) => resolve());
      await Promise.resolve();
    });
  };
  const dropCorrection = (delta: number) =>
    act(() => {
      expect(
        correction({ end: 50 }, delta, {
          scrollOffset: scrollTop,
          scrollDirection: 'backward',
          scrollElement: scrollArea,
        })
      ).toBe(false);
    });
  return {
    rows,
    scrollArea,
    writes,
    scrollTo,
    applyCorrection,
    dropCorrection,
    statusBarScrollTop,
    flushQuiescence,
    endSettleDiscardWatch: () => controller?.endSettleDiscardWatch(),
    takeSettledScrollTop: () => controller?.takeSettledScrollTop(),
    /** The room shows other rows: emptied for an event it has not loaded, say. */
    replaceRows: () =>
      act(() => {
        rowsKey += 1;
        renderer?.update(React.createElement(Ledger));
      }),
    unmount: () => act(() => renderer?.unmount()),
  };
};

describe('the offset ledger after a settle', () => {
  afterEach(() => {
    virtualizer.setOptions.mockClear();
    quiescenceResolvers.length = 0;
  });

  it('names the position its settle wrote, once', () => {
    const ledger = mountRoomLedger();
    expect([ledger.takeSettledScrollTop(), ledger.takeSettledScrollTop()]).toEqual([
      959,
      undefined,
    ]);
  });

  it('folds the settle back in when the view returns to where it was before it', () => {
    const ledger = mountRoomLedger();
    // The compositor dropped the settle's write and put back the old position.
    ledger.scrollTo(0);
    expect(ledger.rows.style.marginTop).toBe('-830px');
    ledger.unmount();
  });

  it('leaves the view where a jump to a row took it', () => {
    const ledger = mountRoomLedger();
    // Jump to Time opens the room's first row, at the top, right after the settle.
    ledger.endSettleDiscardWatch();
    ledger.scrollTo(0);
    expect(ledger.rows.style.marginTop).toBe('');
    expect(ledger.writes).toEqual([959]);
    ledger.unmount();
  });

  it('leaves the settle where it is after a correction the timeline applied itself', () => {
    const ledger = mountRoomLedger();
    // A row above the reader shrinks by 700 px right after the settle, and the timeline moves the
    // view up by as much: close to where it was before the settle, but the settle's write held.
    expect(ledger.applyCorrection(-700)).toBe(true);
    expect(ledger.rows.style.marginTop).toBe('');
    ledger.unmount();
  });

  it('leaves the view alone once the rows it settled for are replaced', () => {
    const ledger = mountRoomLedger();
    // The rows empty for an event the room has not loaded, and the list clamps the view to the top.
    ledger.replaceRows();
    ledger.scrollTo(0);
    expect(ledger.rows.style.marginTop).toBe('');
    expect(ledger.writes).toEqual([959]);
    ledger.unmount();
  });

  it('forgets the position its settle wrote once the rows it settled for are replaced', () => {
    const ledger = mountRoomLedger();
    // No scroll event read the settle's write before the room showed other rows.
    ledger.replaceRows();
    expect(ledger.takeSettledScrollTop()).toBeUndefined();
    ledger.unmount();
  });

  it('drops a fold that the replaced rows were still waiting to settle', () => {
    const ledger = mountRoomLedger({ settle: false });
    ledger.replaceRows();
    expect(ledger.rows.style.marginTop).toBe('');
    ledger.scrollTo(0);
    expect(ledger.writes).toEqual([]);
    ledger.unmount();
  });
});

describe('status-bar tap scroll-to-top with the offset ledger', () => {
  afterEach(() => {
    virtualizer.setOptions.mockClear();
    quiescenceResolvers.length = 0;
    vi.unstubAllGlobals();
  });

  it('clears an unsettled positive ledger, jumps to 0, and prevents boundary or quiescence settles from shifting back down', async () => {
    const ledger = mountRoomLedger({ settle: false });
    expect(ledger.rows.style.marginTop).toBe('-830px');
    expect(ledger.scrollArea.scrollTop).toBe(129);
    expect(quiescenceResolvers).toHaveLength(1);
    virtualizer.setOptions.mockClear();

    const event = ledger.statusBarScrollTop();

    expect(event.defaultPrevented).toBe(true);
    expect(ledger.rows.style.marginTop).toBe('');
    expect(ledger.scrollArea.scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(ledger.scrollArea.scrollTop).toBe(0);
    expect(ledger.writes).toEqual([0]);
    expect(virtualizer.scrollOffset).toBe(0);
    expect(virtualizer.setOptions).toHaveBeenCalledWith({ scrollMargin: 0 });

    // A following scroll event at 0 must not settle the dropped fold or push scrollTop back down.
    ledger.scrollTo(0);
    expect(ledger.scrollArea.scrollTop).toBe(0);
    expect(ledger.rows.style.marginTop).toBe('');
    expect(ledger.writes).toEqual([0]);

    // Scroll down again and arm new debt after the tap (starting a newer waiter).
    ledger.scrollTo(129);
    ledger.dropCorrection(100);
    expect(ledger.rows.style.marginTop).toBe('-100px');
    expect(quiescenceResolvers).toHaveLength(2);

    // Resolving the stale pre-tap waiter must neither settle the new debt nor disarm the newer waiter.
    await ledger.flushQuiescence(1);
    expect(ledger.scrollArea.scrollTop).toBe(129);
    expect(ledger.rows.style.marginTop).toBe('-100px');
    expect(ledger.writes).toEqual([0]);

    // Additional debt must reuse the still-armed newer waiter rather than starting a duplicate.
    ledger.dropCorrection(50);
    expect(ledger.rows.style.marginTop).toBe('-150px');
    expect(quiescenceResolvers).toHaveLength(1);

    // Resolving the newer waiter settles the new 150px debt cleanly.
    await ledger.flushQuiescence(1);
    expect(ledger.rows.style.marginTop).toBe('');
    expect(ledger.scrollArea.scrollTop).toBe(279);

    ledger.unmount();
  });

  it('clears an active settle discard watch so jumping to 0 does not fold the previous settle back in', () => {
    const ledger = mountRoomLedger({ settle: true });
    expect(ledger.writes).toEqual([959]);

    const event = ledger.statusBarScrollTop();

    expect(event.defaultPrevented).toBe(true);
    expect(ledger.scrollArea.scrollTop).toBe(0);
    expect(ledger.writes).toEqual([959, 0]);
    expect(ledger.takeSettledScrollTop()).toBeUndefined();

    // A following scroll event at 0 must not trigger the discard watch to re-apply -830px.
    ledger.scrollTo(0);
    expect(ledger.rows.style.marginTop).toBe('');
    expect(ledger.writes).toEqual([959, 0]);

    ledger.unmount();
  });

  it('clears the thread anchor and ledger in an open thread, jumps to 0, and re-anchors cleanly on the next commit', () => {
    vi.stubGlobal('getComputedStyle', () => ({
      scrollPaddingTop: '0px',
      getPropertyValue: () => '',
    }));
    const makeEvents = (ids: string[]) => ids.map((id) => ({ getId: () => id }));
    let threadEvents = makeEvents(Array.from({ length: 20 }, (_, i) => `$ev-${i}`));
    let scrollTop = 350;
    const writes: number[] = [];
    let onStatusBarScrollTop: ((event: Event) => void) | undefined;
    const scrollArea = {
      clientHeight: 700,
      scrollHeight: 2000,
      getBoundingClientRect: () => ({ top: 0, bottom: 700 }),
      addEventListener: (type: string, listener: (event: Event) => void) => {
        if (type === STATUS_BAR_SCROLL_TOP_EVENT) onStatusBarScrollTop = listener;
      },
      removeEventListener: (type: string, listener: (event: Event) => void) => {
        if (type === STATUS_BAR_SCROLL_TOP_EVENT && onStatusBarScrollTop === listener) {
          onStatusBarScrollTop = undefined;
        }
      },
      scrollTo: vi.fn((options?: ScrollToOptions | number) => {
        if (typeof options === 'object' && options.top !== undefined) {
          scrollArea.scrollTop = options.top;
        }
      }),
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value: number) {
        writes.push(value);
        scrollTop = value;
      },
    };
    const rows = {
      style: { marginTop: '' },
      getBoundingClientRect: () => ({
        top: -scrollTop + (Number.parseFloat(rows.style.marginTop) || 0),
        bottom: 700,
      }),
    };
    let controller: TimelineScrollLedgerController | undefined;
    function ThreadLedger() {
      const threadEventIndexMap = new Map(
        threadEvents.map((ev, index) => [ev.getId() ?? '', index])
      );
      controller = useTimelineScrollLedgerController({
        alive: () => true,
        estimateSize: () => 35,
        getItemKey: (index) => threadEvents[index]?.getId() ?? index,
        getScrollElement: () => scrollArea as unknown as HTMLDivElement,
        itemCount: threadEvents.length,
        pendingRoomFoldPxRef: useRef(0),
        roomFoldPriceRef: useRef(() => 35),
        roomId: '!logbook:example.org',
        threadEventIndexMap,
        threadEvents,
        threadId: '$root:example.org',
        threadInitialRenderMode: 'live',
      });
      return React.createElement('rows', { ref: controller.virtualInnerRef });
    }
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(ThreadLedger), { createNodeMock: () => rows });
    });

    // Accumulate an unsettled positive measurement correction while scrolled to row 10 ($ev-10).
    const correction = virtualizer.shouldAdjustScrollPositionOnItemSizeChange as Correction;
    act(() => {
      expect(
        correction({ end: 100 }, 140, {
          scrollOffset: 350,
          scrollDirection: 'backward',
          scrollElement: scrollArea,
        })
      ).toBe(false);
    });
    expect(rows.style.marginTop).toBe('-140px');

    // Status-bar tap clears marginTop and old anchor, jumps to 0, and re-commits at row 0 ($ev-0).
    const tapEvent = new Event(STATUS_BAR_SCROLL_TOP_EVENT, { cancelable: true });
    act(() => {
      onStatusBarScrollTop?.(tapEvent);
    });
    expect(tapEvent.defaultPrevented).toBe(true);
    expect(rows.style.marginTop).toBe('');
    expect(scrollArea.scrollTop).toBe(0);
    expect(writes).toEqual([0]);

    // Inserting a row below $ev-0 (which was above the old $ev-10 anchor) must NOT fold, proving
    // the old anchor was cleared and re-anchored at $ev-0.
    threadEvents = makeEvents([
      '$ev-0',
      '$ev-inserted-below-0',
      ...Array.from({ length: 19 }, (_, i) => `$ev-${i + 1}`),
    ]);
    act(() => {
      renderer?.update(React.createElement(ThreadLedger));
    });
    expect(rows.style.marginTop).toBe('');

    // Prepending two older rows above $ev-0 folds 2 * 35px cleanly relative to the new $ev-0 anchor.
    threadEvents = makeEvents([
      '$ev-older-1',
      '$ev-older-2',
      '$ev-0',
      '$ev-inserted-below-0',
      ...Array.from({ length: 19 }, (_, i) => `$ev-${i + 1}`),
    ]);
    act(() => {
      renderer?.update(React.createElement(ThreadLedger));
    });
    expect(rows.style.marginTop).toBe('-70px');

    act(() => renderer?.unmount());
  });
});
