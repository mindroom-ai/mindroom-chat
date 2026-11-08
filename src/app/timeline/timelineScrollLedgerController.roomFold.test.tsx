// @vitest-environment jsdom
import { useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';

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

it('keeps a room fold pending through a render that still shows the window it was priced for', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  const scrollElement = { scrollTop: 0, addEventListener() {}, removeEventListener() {} };
  const pendingRoomFoldPxRef = { current: 0 };
  let readRowFoldPx = () => 0;
  function Harness({ held }: { held: boolean }) {
    const controller = useTimelineScrollLedgerController({
      alive: () => true,
      estimateSize: () => 100,
      getItemKey: (index) => index,
      getScrollElement: () => scrollElement as unknown as HTMLDivElement,
      itemCount: 13,
      pendingRoomFoldPxRef,
      roomFoldHeld: held,
      roomFoldPriceRef: useRef(() => 100),
      roomId: '!room:example.org',
      threadEventIndexMap: new Map(),
      threadEvents: [],
      threadInitialRenderMode: 'live',
    });
    readRowFoldPx = controller.readRowFoldPx;
    return <div ref={controller.virtualInnerRef} />;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  const marginTop = () => (container.firstElementChild as HTMLDivElement | null)?.style.marginTop;
  flushSync(() => root.render(<Harness held={false} />));

  // The paginator widened the window over 130 older rows and priced them; a scroll renders the
  // list before the widened window's update, with the window the fold was priced for.
  pendingRoomFoldPxRef.current = 13_000;
  flushSync(() => root.render(<Harness held />));
  expect(marginTop()).toBe('');
  expect(pendingRoomFoldPxRef.current).toBe(13_000);

  // The render that mounts the rows takes the fold, once. The rows brought their own height: the
  // list will not end that much higher (`listShrinkNotRendered`), or the end clamp would throw a
  // reader at the newest row to the top.
  flushSync(() => root.render(<Harness held={false} />));
  expect(marginTop()).toBe('-13000px');
  expect(pendingRoomFoldPxRef.current).toBe(0);
  expect(readRowFoldPx()).toBe(13_000);
  flushSync(() => root.render(<Harness held={false} />));
  expect(marginTop()).toBe('-13000px');
  flushSync(() => root.unmount());
});
