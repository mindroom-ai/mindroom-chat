// @vitest-environment jsdom
import { useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';

type Rect = { width: number; height: number };
type Options = {
  measureElement: (
    element: Element,
    entry: ResizeObserverEntry | undefined,
    instance: object
  ) => number;
  observeElementRect: (instance: object, onRect: (rect: Rect) => void) => void;
};

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
  observeElementRect: (_instance: unknown, onRect: unknown) => {
    virtualizer.reportRect = onRect;
  },
}));

vi.mock('./scrollQuiescence', () => ({
  hasActiveWindowTouches: () => false,
  isIOSWebKitDevice: () => false,
  waitForScrollQuiescence: () => new Promise<void>(() => {}),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The ledger of a room of 40 rows whose reader is at the newest one, the commits it rendered, and
 * whether each took its rows as wrapped anew. `report` is one report of virtual-core's row
 * observer: the newest row, 22 px taller.
 */
const mount = () => {
  // Outside act(), React schedules ordinary updates the way a browser does.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  const frames: (() => void)[] = [];
  vi.stubGlobal('requestAnimationFrame', (frame: () => void) => frames.push(frame));
  const scrollElement = {
    scrollTop: 3400,
    offsetWidth: 700,
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
  const instance = { scrollElement };
  let reportRect: (rect: Rect) => void = () => {};
  options.observeElementRect(instance, () => {});
  reportRect = virtualizer.reportRect as typeof reportRect;
  const report = async (row = { end: 4000, index: 39 }) => {
    options.measureElement(document.createElement('div'), {} as ResizeObserverEntry, instance);
    const correction = virtualizer.shouldAdjustScrollPositionOnItemSizeChange as (
      item: { end: number; index: number },
      delta: number,
      instance: { scrollOffset: number; scrollDirection: 'backward'; scrollElement: object }
    ) => boolean;
    const scrollOffset = scrollElement.scrollTop;
    // While the reader scrolls back no correction is written: the ledger takes a row's above them.
    expect(correction(row, 22, { scrollOffset, scrollDirection: 'backward', scrollElement })).toBe(
      false
    );
    // The observer's callback returns, and the microtasks it queued run before the paint.
    await Promise.resolve();
    await Promise.resolve();
  };
  commits.length = 0;
  return {
    commits,
    frames,
    report,
    reportRect,
    scrollElement,
    unmount: () => flushSync(() => root.unmount()),
  };
};

it('renders rows that wrapped anew with the scroll area before the paint, at the new height', async () => {
  const { commits, report, scrollElement, unmount } = mount();
  // The newest row grows on its own (an image loads): no row moves, and nothing renders.
  await report();
  expect(commits).toEqual([]);

  // A splitter narrows the room: the rows wrap anew in the layout that resized the scroll area.
  scrollElement.offsetWidth = 640;
  await report();
  expect(commits).toEqual([true]);

  // Rows that change size on their own afterwards, even in a later pass of that frame, did not.
  await report();
  expect(commits).toEqual([true]);
  unmount();
});

it('takes the rows of a later render as they are', async () => {
  const { commits, report, scrollElement, unmount } = mount();
  await report();
  // A row above the reader wraps anew, and the ledger takes its growth: it renders in a later
  // task, after the paint, when the rows of that report are no longer the ones being rendered.
  scrollElement.offsetWidth = 640;
  await report({ end: 3000, index: 20 });
  expect(commits).toEqual([]);
  await new Promise((resolve) => {
    setTimeout(resolve, 50);
  });
  expect(commits).toEqual([false]);
  unmount();
});

it('forgets a new width whose frame reported no row', async () => {
  const { commits, frames, report, reportRect, scrollElement, unmount } = mount();
  await report();
  reportRect({ width: 700, height: 800 });
  scrollElement.offsetWidth = 640;
  reportRect({ width: 640, height: 800 });
  expect(frames).toHaveLength(1);
  frames.forEach((frame) => frame());

  // A row that grows in a later frame is reported alone: the content keeps its size in that pass.
  await report();
  expect(commits).toEqual([]);
  unmount();
});
