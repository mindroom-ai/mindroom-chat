import React, { useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useTimelineScrollLedgerController,
  type TimelineScrollLedgerController,
} from './timelineScrollLedgerController';

const virtualizer = vi.hoisted(() => ({
  itemSizeCache: new Map<string, number>(),
  options: {},
  setOptions: vi.fn(),
  shouldAdjustScrollPositionOnItemSizeChange: undefined as unknown,
  getVirtualItems: () => [],
}));

vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: () => virtualizer }));

vi.mock('./rideTraceRecorder', () => ({
  installRideTraceRecorder: vi.fn(),
  isRideTraceEnabled: () => false,
}));

// The wait for rest never ends here, so the only settles are the ones at the boundary.
vi.mock('./scrollQuiescence', () => ({
  hasActiveWindowTouches: () => false,
  isIOSWebKitDevice: () => false,
  waitForScrollQuiescence: () => new Promise<void>(() => undefined),
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
  let onScroll: (() => void) | undefined;
  const scrollArea = {
    clientHeight: 704,
    scrollHeight: 1663,
    getBoundingClientRect: () => ({ top: 0, bottom: 704 }),
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'scroll') onScroll = listener;
    },
    removeEventListener: () => undefined,
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
  return {
    rows,
    writes,
    scrollTo,
    applyCorrection,
    endSettleDiscardWatch: () => controller?.endSettleDiscardWatch(),
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

  it('drops a fold that the replaced rows were still waiting to settle', () => {
    const ledger = mountRoomLedger({ settle: false });
    ledger.replaceRows();
    expect(ledger.rows.style.marginTop).toBe('');
    ledger.scrollTo(0);
    expect(ledger.writes).toEqual([]);
    ledger.unmount();
  });
});
