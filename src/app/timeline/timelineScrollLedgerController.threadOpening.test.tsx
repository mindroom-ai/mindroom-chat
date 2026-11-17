// @vitest-environment jsdom
import { useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Range } from '@tanstack/react-virtual';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useTimelineScrollLedgerController,
  type TimelineScrollLedgerControllerOptions,
} from './timelineScrollLedgerController';

type ListOptions = {
  overscan: number;
  initialOffset: number | (() => number);
  rangeExtractor?: (range: Range) => number[];
};

const virtualizer = vi.hoisted(() => ({
  itemSizeCache: new Map<string, number>(),
  options: {} as unknown,
  scrollOffset: null as number | null,
  scrollRect: { width: 800, height: 400 },
  // 40 rows of 100 px each.
  measurementsCache: Array.from({ length: 40 }, (_, index) => ({
    index,
    start: index * 100,
    end: (index + 1) * 100,
  })),
  setOptions: () => {},
  getVirtualItems: () => [],
  getVirtualItemForOffset: (offset: number) => ({
    index: Math.min(39, Math.max(0, Math.floor(offset / 100))),
  }),
}));

vi.mock('@tanstack/react-virtual', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-virtual')>()),
  useVirtualizer: (options: unknown) => {
    virtualizer.options = options;
    return virtualizer;
  },
}));

vi.mock('./scrollQuiescence', () => ({
  hasActiveWindowTouches: () => false,
  isIOSWebKitDevice: () => false,
  waitForScrollQuiescence: () => new Promise<void>(() => {}),
}));

const scrollElement = document.createElement('div');
Object.defineProperty(scrollElement, 'scrollTop', { value: 3116, writable: true });

const mount = (options: Partial<TimelineScrollLedgerControllerOptions>): ListOptions => {
  virtualizer.scrollOffset = null;
  function Harness() {
    const controller = useTimelineScrollLedgerController({
      alive: () => true,
      estimateSize: (index) => (index === 0 ? 150 : 100),
      getItemKey: (index) => index,
      getScrollElement: () => scrollElement,
      itemCount: 40,
      pendingRoomFoldPxRef: useRef(0),
      roomFoldPriceRef: useRef(() => 100),
      roomId: '!room:example.org',
      threadEventIndexMap: new Map(),
      threadEvents: [],
      threadId: '$thread',
      threadInitialRenderMode: 'live',
      ...options,
    });
    return <div ref={controller.virtualInnerRef} />;
  }
  const root = createRoot(document.createElement('div'));
  flushSync(() => root.render(<Harness />));
  unmount = () => flushSync(() => root.unmount());
  return virtualizer.options as ListOptions;
};
let unmount = () => {};

const inView: Range = { startIndex: 30, endIndex: 33, overscan: 1, count: 40 };

describe('a thread list that opens at its newest reply', () => {
  afterEach(() => unmount());

  it('starts at the estimated end of its rows, and at the place the scroll area took', () => {
    const list = mount({ startAtEnd: true });
    // The first row is estimated at 150 px, the 39 others at 100 px.
    expect(typeof list.initialOffset === 'function' && list.initialOffset()).toBe(4050);
    // virtual-core scrolled the scroll area there, and the browser stopped at its end.
    expect(virtualizer.scrollOffset).toBe(3116);
  });

  it('starts at its first rows otherwise, and leaves the position alone', () => {
    const list = mount({});
    expect(list.initialOffset).toBe(0);
    expect(virtualizer.scrollOffset).toBeNull();
  });

  it('mounts the rows near its view only while asked to', () => {
    const near = mount({ rowsNearViewOnly: true });
    expect(near.overscan).toBe(1);
    // Half a view (200 px) on each side of rows 30 to 33.
    expect(near.rangeExtractor?.(inView)).toEqual([28, 29, 30, 31, 32, 33, 34, 35, 36]);
    unmount();

    const ready = mount({});
    expect(ready.overscan).toBe(10);
    // Two views (800 px) on each side.
    expect(ready.rangeExtractor?.(inView)?.[0]).toBe(22);
    expect(ready.rangeExtractor?.(inView)?.at(-1)).toBe(39);
  });
});
