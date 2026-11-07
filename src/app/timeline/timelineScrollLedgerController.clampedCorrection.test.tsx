// @vitest-environment jsdom
import React, { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';

// virtual-core moves the reader down by a row above them that grew, in its ResizeObserver
// callback, before React renders the longer list. Near the end the browser clamps that write to
// the end the list still has; the render with the longer list finishes it.

const virtualizer = vi.hoisted(() => ({
  itemSizeCache: new Map<string, number>(),
  options: {},
  setOptions: () => {},
  shouldAdjustScrollPositionOnItemSizeChange: undefined as unknown,
  getVirtualItems: () => [],
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => virtualizer,
}));

vi.mock('./scrollQuiescence', () => ({
  hasActiveWindowTouches: () => false,
  isIOSWebKitDevice: () => false,
  waitForScrollQuiescence: () => new Promise<void>(() => {}),
}));

type Correction = (
  item: { end: number },
  delta: number,
  instance: { scrollOffset: number; scrollDirection: null; scrollElement: { scrollTop: number } }
) => boolean;

/** A scroll area whose position the browser keeps between the start and the end of its content. */
const scrollArea = (scrollHeight: number, clientHeight: number, scrollTop: number) => {
  let top = scrollTop;
  return {
    scrollHeight,
    clientHeight,
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight));
    },
    addEventListener() {},
    removeEventListener() {},
  };
};

const mount = (area: ReturnType<typeof scrollArea>) => {
  // Outside act(), React schedules ordinary updates the way a browser does.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  let render = () => {};
  function Harness() {
    const [, setTick] = useState(0);
    render = () => flushSync(() => setTick((tick) => tick + 1));
    const controller = useTimelineScrollLedgerController({
      alive: () => true,
      estimateSize: () => 100,
      getItemKey: (index) => index,
      getScrollElement: () => area as unknown as HTMLDivElement,
      itemCount: 40,
      pendingRoomFoldPxRef: useRef(0),
      roomFoldPriceRef: useRef(() => 100),
      roomId: '!room:example.org',
      threadEventIndexMap: new Map(),
      threadEvents: [],
      threadInitialRenderMode: 'live',
    });
    return <div ref={controller.virtualInnerRef} />;
  }
  const root = createRoot(document.createElement('div'));
  flushSync(() => root.render(<Harness />));
  const correction = virtualizer.shouldAdjustScrollPositionOnItemSizeChange as Correction;
  /** A row above the view grows by `delta`; virtual-core writes an applied correction at once. */
  const grow = (delta: number) => {
    const scrollOffset = area.scrollTop;
    const apply = correction({ end: 1000 }, delta, {
      scrollOffset,
      scrollDirection: null,
      scrollElement: area,
    });
    if (apply) area.scrollTop = scrollOffset + delta;
    return apply;
  };
  return { grow, render, unmount: () => flushSync(() => root.unmount()) };
};

it('finishes a correction the browser clamped at the end once the longer list is rendered', async () => {
  // A reader at the end of a thread: 4631 px of content in an 844 px view.
  const area = scrollArea(4631, 844, 3787);
  const view = mount(area);

  expect(view.grow(8)).toBe(true);
  expect(area.scrollTop).toBe(3787);
  // The ledger renders the moved rows before the paint, with the list's old height.
  await Promise.resolve();
  expect(area.scrollTop).toBe(3787);

  // The next render gives the list its new height.
  area.scrollHeight = 4639;
  view.render();
  expect(area.scrollTop).toBe(3795);
  view.unmount();
});

it('leaves a reader who scrolled away before the longer list was rendered', async () => {
  const area = scrollArea(4631, 844, 3787);
  const view = mount(area);

  expect(view.grow(8)).toBe(true);
  await Promise.resolve();
  area.scrollTop = 3000;

  area.scrollHeight = 4639;
  view.render();
  expect(area.scrollTop).toBe(3000);
  view.unmount();
});
