// @vitest-environment jsdom
import { useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installStatusBarTapScroll } from '../native/statusBarTapScroll';
import { useTimelineScrollLedgerController } from './timelineScrollLedgerController';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15';
const ROW_HEIGHT = 60;
const VIEWPORT_HEIGHT = 844;

type FakeEvent = { getId: () => string };

const makeEvents = (ids: string[]): FakeEvent[] => ids.map((id) => ({ getId: () => id }));

const stubIOSFrames = () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.stubGlobal('navigator', { userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextId += 1;
    frames.set(nextId, callback);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
  const stepFrame = () => {
    const due = [...frames.values()];
    frames.clear();
    due.forEach((callback) => callback(0));
  };
  return { frames, stepFrame };
};

describe('status-bar tap end-to-end with real virtualizer and offset ledger', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  /**
   * Mounts a thread on the real virtualizer, scrolls it deep with a `scroll` event (which arms
   * virtual-core's idle fallback with that offset) and prepends older events above the view for
   * an unsettled positive ledger. With `fakeTimers`, the idle fallback runs on Vitest's timers.
   */
  const mountDeepThreadWithLedger = async ({ fakeTimers = false } = {}) => {
    const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const prevActEnv = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;
    const { frames, stepFrame } = stubIOSFrames();
    const uninstall = installStatusBarTapScroll(window);

    const scrollElement = document.createElement('div');
    scrollElement.style.overflowY = 'auto';
    scrollElement.scrollTop = 6000;
    Object.defineProperties(scrollElement, {
      offsetWidth: { value: 390, configurable: true },
      offsetHeight: { value: VIEWPORT_HEIGHT, configurable: true },
      clientHeight: { value: VIEWPORT_HEIGHT, configurable: true },
      scrollHeight: { get: () => 205 * ROW_HEIGHT, configurable: true },
    });
    scrollElement.getBoundingClientRect = () => ({
      top: 0,
      bottom: VIEWPORT_HEIGHT,
      left: 0,
      right: 390,
      width: 390,
      height: VIEWPORT_HEIGHT,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    scrollElement.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === 'object' && options.top !== undefined) {
        scrollElement.scrollTop = options.top;
      }
    });
    document.body.appendChild(scrollElement);

    const root = createRoot(scrollElement);
    dispose = () => {
      uninstall();
      flushSync(() => root.unmount());
      reactGlobal.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    };
    const getInner = () => scrollElement.querySelector<HTMLDivElement>('[data-list]');
    const mounted: {
      virtualizer?: ReturnType<typeof useTimelineScrollLedgerController>['virtualizer'];
    } = {};

    const patchedNodes = new WeakSet<HTMLDivElement>();

    function ThreadTimeline({ events }: { events: FakeEvent[] }) {
      const pendingRoomFoldPxRef = useRef(0);
      const roomFoldPriceRef = useRef(() => ROW_HEIGHT);
      const alive = useCallback(() => true, []);
      const getScrollElement = useCallback(() => scrollElement, []);
      const threadEventIndexMap = useMemo(
        () => new Map(events.map((event, index) => [event.getId(), index])),
        [events]
      );
      const controller = useTimelineScrollLedgerController({
        alive,
        estimateSize: () => ROW_HEIGHT,
        getItemKey: (index) => events[index]?.getId() ?? index,
        getScrollElement,
        itemCount: events.length,
        pendingRoomFoldPxRef,
        roomFoldPriceRef,
        roomId: '!room:example.org',
        threadEventIndexMap,
        threadEvents: events,
        threadId: '$root:example.org',
        threadInitialRenderMode: 'live',
      });
      const virtualItems = controller.virtualizer.getVirtualItems();
      return (
        <div
          ref={(node) => {
            (controller.virtualInnerRef as { current: HTMLDivElement | null }).current = node;
            mounted.virtualizer = controller.virtualizer;
            if (node && !patchedNodes.has(node)) {
              patchedNodes.add(node);
              // jsdom's cssstyle keeps a negative marginTop when assigned `''`, unlike real browsers.
              let marginTop = '';
              Object.defineProperty(node.style, 'marginTop', {
                get: () => marginTop,
                set: (value: string) => {
                  marginTop = value;
                },
                configurable: true,
              });
            }
            if (node) {
              node.getBoundingClientRect = () => {
                const marginTop = Number.parseFloat(node.style.marginTop) || 0;
                const top = -scrollElement.scrollTop + marginTop;
                const height = controller.virtualizer.getTotalSize();
                return {
                  top,
                  bottom: top + height,
                  left: 0,
                  right: 390,
                  width: 390,
                  height,
                  x: 0,
                  y: top,
                  toJSON: () => ({}),
                };
              };
            }
          }}
          data-list
          style={{ height: controller.virtualizer.getTotalSize() }}
        >
          {virtualItems.map((item) => (
            <div
              key={String(item.key)}
              data-row-index={item.index}
              data-event-id={String(item.key)}
            >
              {String(item.key)}
            </div>
          ))}
        </div>
      );
    }

    const initialEvents = makeEvents(Array.from({ length: 200 }, (_, i) => `$ev-${i}`));
    flushSync(() => root.render(<ThreadTimeline events={initialEvents} />));
    // Allow React passive effects (useEffect) to attach scroll and status-bar listeners.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (fakeTimers) vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    scrollElement.scrollTop = 6000;
    scrollElement.dispatchEvent(new Event('scroll'));
    flushSync(() => root.render(<ThreadTimeline events={initialEvents} />));

    // Scrolled deep into the thread: row 0 is not mounted, row 100 is mounted.
    expect(scrollElement.querySelector('[data-row-index="0"]')).toBeNull();
    const deepRow = scrollElement.querySelector('[data-row-index="100"]');
    expect(deepRow).not.toBeNull();

    // Prepend 5 older events above the anchored viewport to create an unsettled positive ledger.
    const prependedEvents = makeEvents([
      ...Array.from({ length: 5 }, (_, i) => `$older-${i}`),
      ...initialEvents.map((event) => event.getId()),
    ]);
    const rerender = () =>
      flushSync(() => root.render(<ThreadTimeline events={prependedEvents} />));
    rerender();

    expect(getInner()?.style.marginTop).toBe(`-${5 * ROW_HEIGHT}px`);
    expect(scrollElement.scrollTop).toBe(6000);
    expect(scrollElement.querySelector('[data-row-index="0"]')).toBeNull();

    const mountedRowIndexes = () =>
      [...scrollElement.querySelectorAll('[data-row-index]')].map((row) =>
        Number(row.getAttribute('data-row-index'))
      );
    const getVirtualizer = () => {
      const { virtualizer } = mounted;
      if (!virtualizer) throw new Error('The thread timeline never mounted.');
      return virtualizer;
    };
    return {
      deepRow,
      frames,
      getInner,
      getVirtualizer,
      mountedRowIndexes,
      rerender,
      scrollElement,
      stepFrame,
    };
  };

  it('synchronously clears an unsettled positive ledger, mounts row 0 before paint, stops iOS flick, and stays at 0', async () => {
    const { deepRow, frames, getInner, scrollElement, stepFrame } =
      await mountDeepThreadWithLedger();

    // Tap the iOS status bar while scrolled deep with an unsettled positive ledger.
    document.elementFromPoint = () => deepRow;
    window.dispatchEvent(new Event('statusTap'));

    // Synchronously after statusTap (no microtask, no extra scroll event):
    // scrollTop is 0, marginTop is cleared, overflowY is hidden for flick-stop,
    // and row 0 is ALREADY mounted in the DOM.
    expect(scrollElement.scrollTop).toBe(0);
    expect(getInner()?.style.marginTop).toBe('');
    expect(scrollElement.style.overflowY).toBe('hidden');
    expect(scrollElement.querySelector('[data-row-index="0"]')).not.toBeNull();
    expect(scrollElement.querySelector('[data-row-index="0"]')?.getAttribute('data-event-id')).toBe(
      '$older-0'
    );

    // A follow-up scroll event at 0 must keep scrollTop at 0 and row 0 mounted.
    scrollElement.dispatchEvent(new Event('scroll'));
    expect(scrollElement.scrollTop).toBe(0);
    expect(getInner()?.style.marginTop).toBe('');
    expect(scrollElement.querySelector('[data-row-index="0"]')).not.toBeNull();

    // Overflow stays hidden for one frame and restores to auto after two frames.
    expect(frames.size).toBe(1);
    stepFrame();
    expect(scrollElement.style.overflowY).toBe('hidden');
    stepFrame();
    expect(scrollElement.style.overflowY).toBe('auto');
    expect(frames.size).toBe(0);
  });

  it('stays at 0 with row 0 mounted when no scroll event follows the tap and the idle fallback of the scroll before it runs', async () => {
    const {
      deepRow,
      getInner,
      getVirtualizer,
      mountedRowIndexes,
      rerender,
      scrollElement,
      stepFrame,
    } = await mountDeepThreadWithLedger({ fakeTimers: true });
    // The deep scroll's idle fallback is still pending, holding the offset of that scroll.
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    expect(getVirtualizer().scrollOffset).toBe(6000);
    const firstDeepRow = Math.min(...mountedRowIndexes());
    expect(firstDeepRow).toBeGreaterThan(70);

    document.elementFromPoint = () => deepRow;
    window.dispatchEvent(new Event('statusTap'));
    expect(scrollElement.scrollTop).toBe(0);
    expect(getVirtualizer().scrollOffset).toBe(0);
    expect(mountedRowIndexes()).toContain(0);

    // WebKit can coalesce away the scroll event of the jump: none is dispatched here. The
    // flick-stop ends, then virtual-core's 150 ms idle fallback runs well within 400 ms.
    stepFrame();
    stepFrame();
    vi.advanceTimersByTime(400);
    // The idle fallback notifies React outside a sync flush; commit what it left.
    rerender();

    expect(scrollElement.scrollTop).toBe(0);
    expect(getInner()?.style.marginTop).toBe('');
    const rows = mountedRowIndexes();
    expect(rows).toContain(0);
    expect(scrollElement.querySelector('[data-row-index="0"]')?.getAttribute('data-event-id')).toBe(
      '$older-0'
    );
    // The rows from the top down, none of the range the reader left.
    expect(Math.max(...rows)).toBeLessThan(firstDeepRow);
    expect(getVirtualizer().scrollOffset).toBe(0);
    expect(getVirtualizer().isScrolling).toBe(false);
  });
});
