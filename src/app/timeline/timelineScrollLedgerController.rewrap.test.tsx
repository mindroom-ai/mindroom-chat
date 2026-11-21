// @vitest-environment jsdom
import { useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';

type Rect = { width: number; height: number };
type Instance = {
  scrollElement: object;
  elementsCache: Map<number, Element>;
  indexFromElement: (row: Element) => number;
  resizeItem: (index: number, size: number) => void;
};
type Options = {
  measureElement: (
    element: Element,
    entry: ResizeObserverEntry | undefined,
    instance: object
  ) => number;
  observeElementRect: (instance: Instance, onRect: (rect: Rect) => void) => void;
};
type Correction = (
  item: { end: number; index: number },
  delta: number,
  instance: { scrollOffset: number; scrollDirection: 'backward' | null; scrollElement: object }
) => boolean;

/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- the types do not check without them */
const virtualizer = vi.hoisted(() => ({
  itemSizeCache: new Map<string, number>(),
  options: undefined as unknown,
  reportRect: undefined as unknown,
  setOptions: () => {},
  shouldAdjustScrollPositionOnItemSizeChange: undefined as unknown,
  getVirtualItems: () => [],
}));
/* eslint-enable @typescript-eslint/no-unnecessary-type-assertion */

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: unknown) => {
    virtualizer.options = options;
    return virtualizer;
  },
  measureElement: () => 0,
  // As virtual-core: it reads the rect once itself, then its observer reports.
  observeElementRect: (_instance: unknown, onRect: (rect: Rect) => void) => {
    onRect({ width: 700, height: 800 });
    virtualizer.reportRect = onRect;
  },
}));

vi.mock('./scrollQuiescence', () => ({
  hasActiveWindowTouches: () => false,
  isIOSWebKitDevice: () => false,
  waitForScrollQuiescence: () => new Promise<void>(() => {}),
}));

/**
 * The ledger of a room of 40 rows whose reader is at the newest one, the commits it rendered, and
 * whether each took its rows as wrapped anew.
 * - `reportRows` is one report of virtual-core's row observer: the newest row, 22 px taller.
 * - `reportScrollArea` is one report of its observer of the scroll area, whose width is `width`.
 *   `mountedRowPx` is the height of the one mounted row, the newest, which virtual-core has at 22.
 */
const mount = () => {
  // Outside act(), React schedules ordinary updates the way a browser does.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  const layout = { width: 700, mountedRowPx: 22 };
  const scrollElement = {
    scrollTop: 3400,
    // A width that crosses no whole pixel keeps this.
    offsetWidth: 700,
    getBoundingClientRect: () => ({ width: layout.width }),
    addEventListener() {},
    removeEventListener() {},
  };
  const commits: boolean[] = [];
  function Harness() {
    const controller = useTimelineScrollLedgerController({
      alive: () => true,
      estimateSize: () => 100,
      getItemKey: (index) => index,
      getScrollElement: () => scrollElement as unknown as HTMLDivElement,
      itemCount: 40,
      pendingRoomFoldPxRef: useRef(0),
      roomFoldPriceRef: useRef(() => 100),
      roomId: '!room:example.org',
      threadEventIndexMap: new Map(),
      threadEvents: [],
      threadInitialRenderMode: 'live',
    });
    const rewrapped = controller.unrenderedRewrap();
    useLayoutEffect(() => {
      commits.push(rewrapped);
    });
    return <div ref={controller.virtualInnerRef} />;
  }
  const root = createRoot(document.createElement('div'));
  flushSync(() => root.render(<Harness />));
  const options = virtualizer.options as Options;
  const correct = (
    row: { end: number; index: number },
    delta: number,
    // While the reader scrolls back no correction is written: the ledger takes a row's above them.
    scrollDirection: 'backward' | null = 'backward'
  ): boolean =>
    (virtualizer.shouldAdjustScrollPositionOnItemSizeChange as Correction)(row, delta, {
      scrollOffset: scrollElement.scrollTop,
      scrollDirection,
      scrollElement,
    });
  // The observer's callback returns, and the microtasks it queued run before the paint.
  const callbackReturns = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  const mountedRow = {
    isConnected: true,
    getBoundingClientRect: () => ({ height: layout.mountedRowPx }),
  } as unknown as Element;
  const resized: [number, number][] = [];
  let cachedRowPx = 22;
  const instance: Instance = {
    scrollElement,
    elementsCache: new Map([[39, mountedRow]]),
    indexFromElement: () => 39,
    // As virtual-core: a row at a new size asks whether to correct the scroll position.
    resizeItem: (index, size) => {
      resized.push([index, size]);
      if (size !== cachedRowPx)
        expect(correct({ end: 4000, index }, size - cachedRowPx)).toBe(false);
      cachedRowPx = size;
    },
  };
  options.observeElementRect(instance, () => {});
  const reportRect = virtualizer.reportRect as (rect: Rect) => void;
  const reportScrollArea = async () => {
    reportRect({ width: Math.round(layout.width), height: 800 });
    await callbackReturns();
  };
  const measure = () => options.measureElement(mountedRow, {} as ResizeObserverEntry, instance);
  const reportRows = async (row = { end: 4000, index: 39 }) => {
    measure();
    expect(correct(row, 22)).toBe(false);
    await callbackReturns();
  };
  commits.length = 0;
  return {
    callbackReturns,
    commits,
    correct,
    layout,
    measure,
    reportRows,
    reportScrollArea,
    resized,
    unmount: () => flushSync(() => root.unmount()),
  };
};

it('renders rows that wrapped anew at the new height when the rows are reported first', async () => {
  const { commits, layout, reportRows, reportScrollArea, unmount } = mount();
  // The newest row grows on its own (an image loads): no row moves, and nothing renders.
  await reportRows();
  expect(commits).toEqual([]);

  // A splitter narrows the room: the rows wrap anew in the layout that resized the scroll area,
  // and the browser reports both in one pass, the rows first.
  layout.width = 640;
  await reportRows();
  expect(commits).toEqual([true]);
  await reportScrollArea();

  // Rows that change size on their own in a later pass of that frame did not wrap anew.
  await reportRows();
  expect(commits).toEqual([true]);
  unmount();
});

it('measures the rows itself when the scroll area is reported first', async () => {
  const { commits, layout, reportRows, reportScrollArea, resized, unmount } = mount();
  // The newest row wrapped to two lines in the layout that narrowed the scroll area.
  layout.width = 640;
  layout.mountedRowPx = 44;
  await reportScrollArea();
  expect(resized).toEqual([[39, 44]]);
  expect(commits).toEqual([true]);

  // The rows' observer reports that row in the same pass: virtual-core has its size already.
  // A row it reports in a later pass changed size on its own.
  await reportRows();
  expect(commits).toEqual([true]);
  unmount();
});

it('leaves the list alone for rows reported in a later pass than the scroll area', async () => {
  const { commits, layout, reportRows, reportScrollArea, resized, unmount } = mount();
  // The scroll area narrows and no mounted row changes height with it.
  layout.width = 640;
  await reportScrollArea();
  expect(resized).toEqual([[39, 22]]);
  expect(commits).toEqual([]);

  // A row measured in a later pass of the same frame, before any animation frame: a list that
  // changed size there would leave the observers of the scroll content unreported.
  await reportRows();
  expect(commits).toEqual([]);
  unmount();
});

it('sees a new width that crosses no whole pixel', async () => {
  const { commits, layout, reportRows, reportScrollArea, unmount } = mount();
  // 0.2 px narrower, at the same rounded width: a word no longer fits its line.
  layout.width = 699.90625;
  await reportRows();
  expect(commits).toEqual([true]);
  await reportScrollArea();
  layout.width = 700.109375;
  layout.mountedRowPx = 44;
  await reportScrollArea();
  expect(commits).toEqual([true, true]);
  unmount();
});

it('takes the rows of a later render as they are', async () => {
  const { commits, layout, reportRows, unmount } = mount();
  await reportRows();
  // A row above the reader wraps anew, and the ledger takes its growth: it renders in a later
  // task, after the paint, when the rows of that report are no longer the ones being rendered.
  layout.width = 640;
  await reportRows({ end: 3000, index: 20 });
  expect(commits).toEqual([]);
  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
  expect(commits).toEqual([false]);
  unmount();
});

it('takes the permission back when the corrections of one report add up to nothing', async () => {
  const {
    callbackReturns,
    commits,
    correct,
    layout,
    measure,
    reportRows,
    reportScrollArea,
    unmount,
  } = mount();
  // In one report of a new width, a row above the reader grows by 22 px and another shrinks by
  // 22 px. virtual-core corrects the scroll position for each, and the two cancel out.
  layout.width = 640;
  measure();
  expect(correct({ end: 3000, index: 20 }, 22, null)).toBe(true);
  measure();
  expect(correct({ end: 2900, index: 19 }, -22, null)).toBe(true);
  await callbackReturns();
  expect(commits).toEqual([true]);
  await reportScrollArea();

  // A row in view grows alone in a later pass: the list keeps its height in that render.
  await reportRows({ end: 3900, index: 38 });
  expect(commits).toEqual([true, false]);
  unmount();
});

it('takes a size set without a measurement as not wrapped anew', async () => {
  const { callbackReturns, commits, correct, layout, measure, unmount } = mount();
  // A row of one line is reported with the new width and keeps its size: virtual-core asks for
  // no correction.
  layout.width = 640;
  measure();
  await callbackReturns();

  // A fold then sets a row's size itself, with no report of any observer, before the scroll
  // area's observer is called.
  expect(correct({ end: 3900, index: 38 }, 22)).toBe(false);
  await callbackReturns();
  expect(commits).toEqual([false]);
  unmount();
});
