// @vitest-environment jsdom
import { useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';
import { listShrinkNotRendered } from './useListEndClamp';

type CorrectionHook = (
  item: { end: number; index?: number },
  delta: number,
  instance: {
    scrollOffset: number | null;
    scrollDirection: 'forward' | 'backward' | null;
    scrollElement?: { scrollTop: number } | null;
  }
) => boolean;

const virtualizer = vi.hoisted(() => ({
  itemSizeCache: new Map<string, number>(),
  measurementsCache: [] as { index: number; size: number }[],
  options: {},
  setOptions: () => {},
  shouldAdjustScrollPositionOnItemSizeChange: undefined as unknown,
  getVirtualItems: () => [],
  getVirtualItemForOffset: () => undefined,
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => virtualizer,
}));

vi.mock('./scrollQuiescence', () => ({
  hasActiveWindowTouches: () => false,
  isIOSWebKitDevice: () => false,
  waitForScrollQuiescence: () => new Promise<void>(() => {}),
}));

/**
 * The end clamp's reading of the list after a row above the reader grew by 62 px while the reader
 * scrolled up, so the ledger took the correction into its margin, and the list rendered the row's
 * new height: the list ends at its newest row.
 */
const shrinkAfterDroppedCorrection = (threadId: string | undefined): number => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  const scrollElement = document.createElement('div');
  scrollElement.scrollTop = 400;
  // The list is scrolled 400 px up out of the scroller, whose top is at 0.
  const rect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return { top: this.hasAttribute('data-list') ? -400 : 0 } as DOMRect;
    });
  let readRowFoldPx = () => 0;
  function Harness() {
    const controller = useTimelineScrollLedgerController({
      alive: () => true,
      estimateSize: () => 100,
      getItemKey: (index) => index,
      getScrollElement: () => scrollElement,
      itemCount: 2,
      pendingRoomFoldPxRef: useRef(0),
      roomFoldPriceRef: useRef(() => 100),
      roomId: '!room:example.org',
      threadEventIndexMap: new Map(),
      threadEvents: [],
      threadId,
      threadInitialRenderMode: 'live',
    });
    readRowFoldPx = controller.readRowFoldPx;
    return (
      <div ref={controller.virtualInnerRef} data-list>
        <div data-index="0" />
        <div data-index="1" />
      </div>
    );
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => root.render(<Harness />));

  const hook = virtualizer.shouldAdjustScrollPositionOnItemSizeChange as CorrectionHook;
  const applied = hook({ end: 100, index: 0 }, 62, {
    scrollOffset: 400,
    scrollDirection: 'backward',
    scrollElement,
  });
  flushSync(() => root.render(<Harness />));
  const inner = container.firstElementChild as HTMLElement;
  expect(applied).toBe(false);
  expect(inner.style.marginTop).toBe('-62px');

  // The newest row ends where the list ends.
  const box = (bottom: number, height: number) => () => ({ bottom, height } as DOMRect);
  inner.getBoundingClientRect = box(800, 400);
  inner.querySelectorAll<HTMLElement>('[data-index]').forEach((tile, index) => {
    Object.defineProperty(tile, 'offsetHeight', { value: 200 });
    tile.getBoundingClientRect = box(600 + index * 200, 200);
  });
  const rows = [
    { index: 0, size: 200 },
    { index: 1, size: 200 },
  ];
  const shrink = listShrinkNotRendered(inner, rows, readRowFoldPx());
  flushSync(() => root.unmount());
  rect.mockRestore();
  return shrink;
};

it('reads no shrink in a thread whose row above the reader grew and moved into the ledger', () => {
  // The thread's list holds all its rows: it rendered the grown row, so the margin lifts it
  // without the list giving up any room, and the end clamp must not pull the reader up.
  expect(shrinkAfterDroppedCorrection('$thread')).toBe(0);
});

it('still reads the correction as shrink in the room view', () => {
  expect(shrinkAfterDroppedCorrection(undefined)).toBe(62);
});
