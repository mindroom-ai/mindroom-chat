// @vitest-environment jsdom
import { useCallback, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Virtualizer,
  _resetIOSDetectionForTests,
  elementScroll,
  observeElementOffset,
  observeElementRect,
} from '@tanstack/virtual-core';
import {
  EXPAND_ALL_LINE_ESTIMATE_PX,
  ROOM_INTRO_KEY,
  THREAD_LOAD_OLDER_KEY,
} from './roomTimelineRows';
import {
  readVirtualizerHoldOffset,
  useTimelineScrollLedgerController,
} from './timelineScrollLedgerController';
import { useVirtualPaginator } from './useVirtualPaginator';

const ROW_HEIGHT = 100;
const THREAD_LOAD_OLDER_PX = 40;
const VIEWPORT_HEIGHT = 600;
const SAFARI_MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

const stubSafariMac = () => {
  Object.defineProperty(navigator, 'userAgent', { value: SAFARI_MAC_UA, configurable: true });
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
};

const createScrollElement = (getTotalHeight: () => number, initialScrollTop = 0) => {
  const scrollElement = document.createElement('div');
  scrollElement.scrollTop = initialScrollTop;
  Object.defineProperties(scrollElement, {
    clientWidth: { value: 390, configurable: true },
    clientHeight: { value: VIEWPORT_HEIGHT, configurable: true },
    offsetWidth: { value: 390, configurable: true },
    offsetHeight: { value: VIEWPORT_HEIGHT, configurable: true },
    scrollHeight: { get: getTotalHeight, configurable: true },
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
      const max = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
      scrollElement.scrollTop = Math.min(Math.max(0, options.top), max);
    }
  });
  document.body.appendChild(scrollElement);
  return scrollElement;
};

describe('stable leading tile prepend anchoring in oldest-first timelines', () => {
  let dispose: (() => void) | undefined;
  const origUA = navigator.userAgent;
  const origPlatform = navigator.platform;
  const origTouchPoints = navigator.maxTouchPoints;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.useRealTimers();
    _resetIOSDetectionForTests();
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'userAgent', { value: origUA, configurable: true });
    Object.defineProperty(navigator, 'platform', { value: origPlatform, configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: origTouchPoints,
      configurable: true,
    });
    document.body.replaceChildren();
  });

  const mountTimeline = async ({
    initialKeys,
    initialScrollTop = 0,
    leadingKey = ROOM_INTRO_KEY,
    leadingHeight = EXPAND_ALL_LINE_ESTIMATE_PX,
    thread = false,
    latestAtTop = false,
  }: {
    initialKeys: string[];
    initialScrollTop?: number;
    leadingKey?: string;
    leadingHeight?: number;
    thread?: boolean;
    latestAtTop?: boolean;
  }) => {
    const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const prevActEnv = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;

    class StubResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', StubResizeObserver);

    let totalHeight = initialKeys.length * ROW_HEIGHT;
    const scrollElement = createScrollElement(() => totalHeight, initialScrollTop);
    const root = createRoot(scrollElement);
    dispose = () => {
      flushSync(() => root.unmount());
      reactGlobal.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    };

    const mounted: {
      virtualizer?: ReturnType<typeof useTimelineScrollLedgerController>['virtualizer'];
    } = {};

    function Harness({ keys, tick }: { keys: string[]; tick: number }) {
      void tick;
      const getScrollElement = useCallback(() => scrollElement, []);
      const controller = useTimelineScrollLedgerController({
        estimateSize: (index = 0) =>
          keys[index] === leadingKey ? leadingHeight + 0.5 : ROW_HEIGHT,
        getItemKey: (index) => keys[index] ?? index,
        getScrollElement,
        itemCount: keys.length,
        latestAtTop,
        roomId: '!room:example.org',
        threadId: thread ? '$thread-root' : undefined,
        pinThreadLeadingItem: thread && keys[0] === THREAD_LOAD_OLDER_KEY,
        canLoadOlder: !latestAtTop,
      });
      mounted.virtualizer = controller.virtualizer;
      totalHeight = controller.virtualizer.getTotalSize();

      const items = controller.virtualizer.getVirtualItems();
      return (
        <div ref={controller.virtualInnerRef} style={{ position: 'relative', height: totalHeight }}>
          {items.map((item) => (
            <div
              key={String(item.key)}
              data-index={item.index}
              data-key={String(item.key)}
              ref={(node) => {
                if (node) {
                  Object.defineProperty(node, 'offsetHeight', {
                    value: item.key === leadingKey ? leadingHeight : ROW_HEIGHT,
                    configurable: true,
                  });
                }
                controller.measureElement(node);
              }}
              style={{ position: 'absolute', top: item.start }}
            >
              {String(item.key)}
            </div>
          ))}
        </div>
      );
    }

    let currentKeys = initialKeys;
    let tick = 0;
    const render = (nextKeys = currentKeys) => {
      currentKeys = nextKeys;
      tick += 1;
      flushSync(() => root.render(<Harness keys={currentKeys} tick={tick} />));
    };

    render();
    await Promise.resolve();
    scrollElement.scrollTop = initialScrollTop;
    scrollElement.dispatchEvent(new Event('scroll'));
    render();
    await Promise.resolve();

    return {
      scrollElement,
      render,
      getVirtualizer: () => mounted.virtualizer!,
      getTileTop: (key: string) => {
        const el = scrollElement.querySelector<HTMLElement>(`[data-key="${key}"]`);
        return el ? Number.parseFloat(el.style.top) : undefined;
      },
    };
  };

  it.each([0, 12, 200])(
    'holds the oldest visible room message when a backward page lands after [+all] at scrollTop=%i',
    async (initialScrollTop) => {
      const rows = Array.from({ length: 40 }, (_, i) => `$ev-${i}`);
      const { scrollElement, render, getTileTop } = await mountTimeline({
        initialKeys: [ROOM_INTRO_KEY, ...rows],
        initialScrollTop,
        leadingKey: ROOM_INTRO_KEY,
        leadingHeight: EXPAND_ALL_LINE_ESTIMATE_PX,
      });
      const anchorKey = initialScrollTop < EXPAND_ALL_LINE_ESTIMATE_PX ? '$ev-0' : '$ev-2';
      const yOf = () => getTileTop(anchorKey)! - scrollElement.scrollTop;
      const before = yOf();
      if (initialScrollTop === 0) expect(before).toBe(EXPAND_ALL_LINE_ESTIMATE_PX);
      expect(before).toBeGreaterThanOrEqual(0);
      expect(before).toBeLessThan(ROW_HEIGHT);

      const older = Array.from({ length: 8 }, (_, i) => `$older-${i}`);
      render([ROOM_INTRO_KEY, ...older, ...rows]);
      await Promise.resolve();
      render();

      expect(yOf()).toBeCloseTo(before, 0);
      expect(scrollElement.scrollTop).toBeCloseTo(initialScrollTop + older.length * ROW_HEIGHT, 0);
    }
  );

  it.each([0, 20, 200])(
    'holds the oldest visible thread reply when Load Older prepends after item 0 at scrollTop=%i',
    async (initialScrollTop) => {
      const replies = Array.from({ length: 40 }, (_, i) => `$reply-${i}`);
      const { scrollElement, render, getTileTop } = await mountTimeline({
        initialKeys: [THREAD_LOAD_OLDER_KEY, ...replies],
        initialScrollTop,
        leadingKey: THREAD_LOAD_OLDER_KEY,
        leadingHeight: THREAD_LOAD_OLDER_PX,
        thread: true,
      });
      const anchorKey = initialScrollTop < THREAD_LOAD_OLDER_PX ? '$reply-0' : '$reply-2';
      const yOf = () => getTileTop(anchorKey)! - scrollElement.scrollTop;
      const before = yOf();
      if (initialScrollTop === 0) expect(before).toBe(THREAD_LOAD_OLDER_PX);
      expect(before).toBeGreaterThanOrEqual(0);
      expect(before).toBeLessThan(ROW_HEIGHT);

      const older = Array.from({ length: 8 }, (_, i) => `$older-reply-${i}`);
      render([THREAD_LOAD_OLDER_KEY, ...older, ...replies]);
      await Promise.resolve();
      render();

      expect(yOf()).toBeCloseTo(before, 0);
      expect(scrollElement.scrollTop).toBeCloseTo(initialScrollTop + older.length * ROW_HEIGHT, 0);
    }
  );

  it.each([0, 20, 60])(
    'holds the oldest visible thread reply after [Load Older, thread root] when older replies prepend at scrollTop=%i',
    async (initialScrollTop) => {
      const replies = Array.from({ length: 40 }, (_, i) => `$reply-${i}`);
      const { scrollElement, render, getTileTop } = await mountTimeline({
        initialKeys: [THREAD_LOAD_OLDER_KEY, '$thread-root', ...replies],
        initialScrollTop,
        leadingKey: THREAD_LOAD_OLDER_KEY,
        leadingHeight: THREAD_LOAD_OLDER_PX,
        thread: true,
      });
      const yOf = () => getTileTop('$reply-0')! - scrollElement.scrollTop;
      const before = yOf();
      expect(before).toBe(THREAD_LOAD_OLDER_PX + ROW_HEIGHT - initialScrollTop);

      const older = Array.from({ length: 8 }, (_, i) => `$older-reply-${i}`);
      render([THREAD_LOAD_OLDER_KEY, '$thread-root', ...older, ...replies]);
      await Promise.resolve();
      render();

      expect(yOf()).toBeCloseTo(before, 0);
      expect(scrollElement.scrollTop).toBeCloseTo(initialScrollTop + older.length * ROW_HEIGHT, 0);
    }
  );

  it('keeps the first message at y=22 when useVirtualPaginator widens backward at scrollTop=0', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubSafariMac();
    const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const prevActEnv = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;

    class StubResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', StubResizeObserver);

    class StubIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);

    const allRows = Array.from({ length: 80 }, (_, i) => `$ev-${i}`);
    let totalHeight = 41 * ROW_HEIGHT;
    const scrollElement = createScrollElement(() => totalHeight, 1000);
    const root = createRoot(scrollElement);
    dispose = () => {
      flushSync(() => root.unmount());
      reactGlobal.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    };

    const mounted: {
      virtualizer?: ReturnType<typeof useTimelineScrollLedgerController>['virtualizer'];
      range?: { start: number; end: number };
    } = {};

    function PaginatedRoomHarness({ tick }: { tick: number }) {
      void tick;
      const [range, setRange] = useState({ start: 40, end: 80 });
      mounted.range = range;
      const windowRows = allRows.slice(range.start, range.end);
      const keys = [ROOM_INTRO_KEY, ...windowRows];
      const getScrollElement = useCallback(() => scrollElement, []);
      const controller = useTimelineScrollLedgerController({
        estimateSize: (index = 0) =>
          keys[index] === ROOM_INTRO_KEY ? EXPAND_ALL_LINE_ESTIMATE_PX + 0.5 : ROW_HEIGHT,
        getItemKey: (index) => keys[index] ?? index,
        getScrollElement,
        itemCount: keys.length,
        roomId: '!room:example.org',
        canLoadOlder: range.start > 0,
      });
      mounted.virtualizer = controller.virtualizer;
      totalHeight = controller.virtualizer.getTotalSize();

      const paginator = useVirtualPaginator({
        count: allRows.length,
        limit: 8,
        range,
        onRangeChange: (next) => setRange(next),
        getScrollElement,
        getItemElement: () => undefined,
        readAhead: true,
        externalBackwardScrollRestore: true,
      });

      const holdOffset = readVirtualizerHoldOffset(controller.virtualizer);
      const backRef = useRef<HTMLDivElement | null>(null);
      const items = controller.virtualizer.getVirtualItems();
      return (
        <div ref={controller.virtualInnerRef} style={{ position: 'relative', height: totalHeight }}>
          {range.start > 0 && (
            <div
              ref={(el) => {
                backRef.current = el;
                if (el) {
                  el.getBoundingClientRect = () => {
                    const top = -holdOffset - scrollElement.scrollTop;
                    return {
                      top,
                      bottom: top + 1,
                      left: 0,
                      right: 390,
                      width: 390,
                      height: 1,
                      x: 0,
                      y: top,
                      toJSON: () => ({}),
                    };
                  };
                }
                paginator.observeBackAnchor(el);
              }}
              style={{ position: 'absolute', top: -holdOffset, height: 1 }}
            />
          )}
          {items.map((item) => (
            <div
              key={String(item.key)}
              data-index={item.index}
              data-key={String(item.key)}
              ref={(node) => {
                if (node) {
                  Object.defineProperty(node, 'offsetHeight', {
                    value: item.key === ROOM_INTRO_KEY ? EXPAND_ALL_LINE_ESTIMATE_PX : ROW_HEIGHT,
                    configurable: true,
                  });
                }
                controller.measureElement(node);
              }}
              style={{ position: 'absolute', top: item.start }}
            >
              {String(item.key)}
            </div>
          ))}
        </div>
      );
    }

    flushSync(() => root.render(<PaginatedRoomHarness tick={0} />));
    await Promise.resolve();
    expect(mounted.range).toEqual({ start: 40, end: 80 });

    const yOf = (key: string) => {
      const el = scrollElement.querySelector<HTMLElement>(`[data-key="${key}"]`);
      return el ? Number.parseFloat(el.style.top) - scrollElement.scrollTop : undefined;
    };

    // Scrolling to 0 widens one page (40 -> 32) without cascading and keeps $ev-40 at y=22.
    flushSync(() => {
      scrollElement.scrollTop = 0;
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    expect(mounted.range!.start).toBe(32);
    expect(scrollElement.scrollTop).toBe(800);
    expect(yOf('$ev-40')).toBe(EXPAND_ALL_LINE_ESTIMATE_PX);

    // Same at scrollTop=0 during a live desktop WebKit wheel: holds +800 then flushes cleanly.
    scrollElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }));
    flushSync(() => {
      scrollElement.scrollTop = 0;
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    expect(mounted.range!.start).toBe(24);
    expect(scrollElement.scrollTop).toBe(0);
    expect(readVirtualizerHoldOffset(mounted.virtualizer!)).toBe(800);
    expect(yOf('$ev-32')).toBe(EXPAND_ALL_LINE_ESTIMATE_PX);

    vi.advanceTimersByTime(300);
    expect(readVirtualizerHoldOffset(mounted.virtualizer!)).toBe(0);
    expect(scrollElement.scrollTop).toBe(800);
    expect(yOf('$ev-32')).toBe(EXPAND_ALL_LINE_ESTIMATE_PX);
  });

  it('anchors on item 1 even when single-lane lazy measurements have not materialized index 1', () => {
    const baseRows = Array.from({ length: 12 }, (_, i) => `$ev-${i}`);
    let keys = [ROOM_INTRO_KEY, ...baseRows];
    let totalHeight = 1300;
    const scrollElement = createScrollElement(() => totalHeight, 0);
    const opts = () => ({
      count: keys.length,
      getScrollElement: () => scrollElement,
      estimateSize: (index: number) => (keys[index] === ROOM_INTRO_KEY ? 22 : ROW_HEIGHT),
      getItemKey: (index: number) => keys[index]!,
      anchorTo: 'end' as const,
      scrollEndThreshold: -1,
      observeElementRect,
      observeElementOffset,
      scrollToFn: elementScroll,
    });
    const virtualizer = new Virtualizer(opts());
    const unmount = virtualizer._didMount();
    dispose = unmount;
    virtualizer._willUpdate();
    totalHeight = virtualizer.getTotalSize();

    // Never call getVirtualItems(): single-lane items[1] is still a raw key string, not an object.
    const singleLane = (virtualizer as unknown as { _singleLaneMeasurements: { items: unknown[] } })
      ._singleLaneMeasurements;
    expect(singleLane.items[1]).toBe('$ev-0');
    keys = [ROOM_INTRO_KEY, '$older-0', '$older-1', '$older-2', ...baseRows];
    virtualizer.setOptions(opts());
    totalHeight = virtualizer.getTotalSize();
    virtualizer._willUpdate();

    expect(scrollElement.scrollTop).toBe(300);
    const ev0 = virtualizer.getVirtualItems().find((item) => item.key === '$ev-0');
    expect(ev0!.start - scrollElement.scrollTop).toBe(22);
  });

  it('does not adjust scrollTop on anchorTo: start when items insert after a stable item 0', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => `$ev-${i}`);
    const { scrollElement, render } = await mountTimeline({
      initialKeys: [ROOM_INTRO_KEY, ...rows],
      initialScrollTop: 0,
      latestAtTop: true,
    });

    const inserted = Array.from({ length: 8 }, (_, i) => `$inserted-${i}`);
    render([ROOM_INTRO_KEY, ...inserted, ...rows]);
    await Promise.resolve();
    render();

    expect(scrollElement.scrollTop).toBe(0);
  });
});
