// @vitest-environment jsdom
import { useCallback } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { _resetIOSDetectionForTests } from '@tanstack/react-virtual';
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
  return { stepFrame };
};

describe('status-bar tap end-to-end with real virtualizer', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    _resetIOSDetectionForTests();
  });

  const mountDeepTimeline = async (threadId?: string) => {
    const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const prevActEnv = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;
    const { stepFrame } = stubIOSFrames();
    _resetIOSDetectionForTests();
    const uninstall = installStatusBarTapScroll(window);

    const scrollElement = document.createElement('div');
    scrollElement.style.overflowY = 'auto';
    scrollElement.scrollTop = 6000;
    Object.defineProperties(scrollElement, {
      clientWidth: { value: 390, configurable: true },
      offsetWidth: { value: 390, configurable: true },
      offsetHeight: { value: VIEWPORT_HEIGHT, configurable: true },
      clientHeight: { value: VIEWPORT_HEIGHT, configurable: true },
      scrollHeight: { get: () => 205 * ROW_HEIGHT + 350, configurable: true },
    });
    scrollElement.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === 'object' && options.top !== undefined) {
        scrollElement.scrollTop = Math.max(0, options.top);
      }
    });
    document.body.appendChild(scrollElement);

    const root = createRoot(scrollElement);
    dispose = () => {
      uninstall();
      flushSync(() => root.unmount());
      reactGlobal.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    };

    const mounted: {
      virtualizer?: ReturnType<typeof useTimelineScrollLedgerController>['virtualizer'];
    } = {};
    const events = makeEvents(Array.from({ length: 200 }, (_, i) => `$ev-${i}`));

    function Timeline({ rows }: { rows: FakeEvent[] }) {
      const getScrollElement = useCallback(() => scrollElement, []);
      const controller = useTimelineScrollLedgerController({
        estimateSize: () => ROW_HEIGHT,
        getItemKey: (index) => rows[index]?.getId() ?? index,
        getScrollElement,
        itemCount: rows.length,
        roomId: '!room:example.org',
        threadId,
      });
      mounted.virtualizer = controller.virtualizer;
      const virtualItems = controller.virtualizer.getVirtualItems();
      return (
        <div
          ref={controller.virtualInnerRef}
          style={{ height: controller.virtualizer.getTotalSize() }}
        >
          {virtualItems.map((item) => (
            <div key={String(item.key)} data-row-index={item.index}>
              {String(item.key)}
            </div>
          ))}
        </div>
      );
    }

    let currentRows = events;
    const renderRows = (nextRows = currentRows) => {
      currentRows = nextRows;
      flushSync(() => root.render(<Timeline rows={currentRows} />));
    };
    renderRows();
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    scrollElement.scrollTop = 6000;
    scrollElement.dispatchEvent(new Event('scroll'));
    renderRows();

    return {
      scrollElement,
      stepFrame,
      renderRows,
      getVirtualizer: () => mounted.virtualizer!,
    };
  };

  for (const [label, threadId] of [
    ['oldest-first room', undefined],
    ['open thread', '$thread-1'],
  ] as const) {
    it(`discards held iOS flick _holdOffset on status-bar tap in ${label} so quiescence keeps scrollTop at 0`, async () => {
      const { scrollElement, stepFrame, renderRows, getVirtualizer } =
        await mountDeepTimeline(threadId);
      const deepRow = scrollElement.querySelector('[data-row-index="100"]');
      expect(deepRow).not.toBeNull();

      // Active iOS flick holds above-viewport size growth in _holdOffset.
      scrollElement.dispatchEvent(new Event('touchstart'));
      scrollElement.scrollTop = 5900;
      scrollElement.dispatchEvent(new Event('scroll'));
      getVirtualizer().resizeItem(10, ROW_HEIGHT + 350);
      expect((getVirtualizer() as unknown as { _holdOffset: number })._holdOffset).toBe(350);

      // Tap the iOS status bar mid-flick: jump to 0, mount row 0, and discard _holdOffset.
      document.elementFromPoint = () => deepRow;
      window.dispatchEvent(new Event('statusTap'));
      expect(scrollElement.scrollTop).toBe(0);
      expect((getVirtualizer() as unknown as { _holdOffset: number })._holdOffset).toBe(0);
      expect(scrollElement.querySelector('[data-row-index="0"]')).not.toBeNull();

      // End the touch/flick-stop and let all quiescence timers run: must stay at 0, not 350.
      scrollElement.dispatchEvent(new Event('touchend'));
      stepFrame();
      stepFrame();
      vi.advanceTimersByTime(400);
      scrollElement.dispatchEvent(new Event('scroll'));
      renderRows();

      expect(scrollElement.scrollTop).toBe(0);
      expect(getVirtualizer().scrollOffset).toBe(0);
      expect(scrollElement.querySelector('[data-row-index="0"]')).not.toBeNull();
    });
  }
});
