// @vitest-environment jsdom
import { useCallback, useState } from 'react';
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
const rangeKeys = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`);
type ActGlobal = { IS_REACT_ACT_ENVIRONMENT?: boolean };
const SAFARI_MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const setNavigator = (userAgent: string, platform: string, maxTouchPoints: number) =>
  Object.defineProperties(navigator, {
    userAgent: { value: userAgent, configurable: true },
    platform: { value: platform, configurable: true },
    maxTouchPoints: { value: maxTouchPoints, configurable: true },
  });

const makeRect = (top: number, height: number) =>
  ({
    top,
    bottom: top + height,
    left: 0,
    right: 390,
    width: 390,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const setHeight = (node: HTMLElement | null, value: number) => {
  if (node) Object.defineProperty(node, 'offsetHeight', { value, configurable: true });
};
const renderTiles = (
  items: ReturnType<
    ReturnType<typeof useTimelineScrollLedgerController>['virtualizer']['getVirtualItems']
  >,
  measureElement: (node: Element | null) => void,
  heightFor: (key: string) => number
) =>
  items.map((item) => (
    <div
      key={String(item.key)}
      data-index={item.index}
      data-key={String(item.key)}
      ref={(node) => {
        setHeight(node, heightFor(String(item.key)));
        measureElement(node);
      }}
      style={{ position: 'absolute', top: item.start }}
    >
      {String(item.key)}
    </div>
  ));

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
  scrollElement.getBoundingClientRect = () => makeRect(0, VIEWPORT_HEIGHT);
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
    setNavigator(origUA, origPlatform, origTouchPoints);
    document.body.replaceChildren();
  });

  const mountRoot = (scrollElement: HTMLElement) => {
    const prevActEnv = (globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT = false;
    const root = createRoot(scrollElement);
    dispose = () => {
      flushSync(() => root.unmount());
      (globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    };
    return root;
  };

  const mountTimeline = async ({
    initialKeys,
    initialScrollTop = 0,
    headerHeight = 0,
    rootHeight = ROW_HEIGHT,
    thread = false,
    latestAtTop = false,
  }: {
    initialKeys: string[];
    initialScrollTop?: number;
    headerHeight?: number;
    rootHeight?: number;
    thread?: boolean;
    latestAtTop?: boolean;
  }) => {
    const leadingKey = thread ? THREAD_LOAD_OLDER_KEY : ROOM_INTRO_KEY;
    const leadingHeight = thread ? THREAD_LOAD_OLDER_PX : EXPAND_ALL_LINE_ESTIMATE_PX;
    vi.stubGlobal('ResizeObserver', NoopObserver);
    let totalHeight = initialKeys.length * ROW_HEIGHT;
    const scrollElement = createScrollElement(() => headerHeight + totalHeight, initialScrollTop);
    const root = mountRoot(scrollElement);

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
        anchorSkipLeading: latestAtTop
          ? 0
          : thread
            ? (keys[0] === THREAD_LOAD_OLDER_KEY ? 1 : 0) + (keys.includes('$thread-root') ? 1 : 0)
            : keys[0] === ROOM_INTRO_KEY
              ? 1
              : 0,
        canLoadOlder: !latestAtTop,
      });
      totalHeight = controller.virtualizer.getTotalSize();

      const tileHeight = (key: string) =>
        key === leadingKey ? leadingHeight : key === '$thread-root' ? rootHeight : ROW_HEIGHT;
      return (
        <>
          {headerHeight > 0 && (
            <div
              data-testid="thread-header"
              ref={(node) => setHeight(node, headerHeight)}
              style={{ height: headerHeight }}
            />
          )}
          <div
            ref={controller.virtualInnerRef}
            style={{ position: 'relative', height: totalHeight }}
          >
            {renderTiles(
              controller.virtualizer.getVirtualItems(),
              controller.measureElement,
              tileHeight
            )}
          </div>
        </>
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

    const getTileY = (key: string) => {
      const el = scrollElement.querySelector<HTMLElement>(`[data-key="${key}"]`);
      return headerHeight + Number.parseFloat(el!.style.top) - scrollElement.scrollTop;
    };
    const flushKeys = async (nextKeys: string[]) => {
      render(nextKeys);
      await Promise.resolve();
      render();
    };
    return { scrollElement, flushKeys, getTileY };
  };

  const expectItem0PrependHolds = async (initialScrollTop: number, thread: boolean) => {
    const leadingKey = thread ? THREAD_LOAD_OLDER_KEY : ROOM_INTRO_KEY;
    const leadingHeight = thread ? THREAD_LOAD_OLDER_PX : EXPAND_ALL_LINE_ESTIMATE_PX;
    const prefix = thread ? '$reply-' : '$ev-';
    const rows = rangeKeys(prefix, 40);
    const { scrollElement, flushKeys, getTileY } = await mountTimeline({
      initialKeys: [leadingKey, ...rows],
      initialScrollTop,
      thread,
    });
    const anchorKey = initialScrollTop < leadingHeight ? `${prefix}0` : `${prefix}2`;
    const before = getTileY(anchorKey);
    if (initialScrollTop === 0) expect(before).toBe(leadingHeight);
    expect(before).toBeGreaterThanOrEqual(0);
    expect(before).toBeLessThan(ROW_HEIGHT);

    const older = rangeKeys(`$older-${prefix.slice(1)}`, 8);
    await flushKeys([leadingKey, ...older, ...rows]);
    expect(getTileY(anchorKey)).toBeCloseTo(before, 0);
    expect(scrollElement.scrollTop).toBeCloseTo(initialScrollTop + older.length * ROW_HEIGHT, 0);
  };

  it.each([0, 12, 200])(
    'holds the oldest visible room message when a backward page lands after [+all] at scrollTop=%i',
    (scrollTop) => expectItem0PrependHolds(scrollTop, false)
  );

  it.each([0, 20, 200])(
    'holds the oldest visible thread reply when Load Older prepends after item 0 at scrollTop=%i',
    (scrollTop) => expectItem0PrependHolds(scrollTop, true)
  );

  it.each([0, 20, 60])(
    'holds the oldest visible thread reply after [Load Older, thread root] when older replies prepend at scrollTop=%i',
    async (initialScrollTop) => {
      const replies = rangeKeys('$reply-', 40);
      const { scrollElement, flushKeys, getTileY } = await mountTimeline({
        initialKeys: [THREAD_LOAD_OLDER_KEY, '$thread-root', ...replies],
        initialScrollTop,
        thread: true,
      });
      const before = getTileY('$reply-0');
      expect(before).toBe(THREAD_LOAD_OLDER_PX + ROW_HEIGHT - initialScrollTop);

      const older = rangeKeys('$older-reply-', 8);
      await flushKeys([THREAD_LOAD_OLDER_KEY, '$thread-root', ...older, ...replies]);
      expect(getTileY('$reply-0')).toBeCloseTo(before, 0);
      expect(scrollElement.scrollTop).toBeCloseTo(initialScrollTop + older.length * ROW_HEIGHT, 0);
    }
  );

  it.each([
    [300, 100],
    [200, 200],
  ])(
    'keeps the paragraph in view when older replies arrive below a tall expanded thread root at scrollTop=%i',
    async (initialScrollTop, expectedParagraphY) => {
      const replies = rangeKeys('$reply-', 40);
      const { scrollElement, flushKeys, getTileY } = await mountTimeline({
        initialKeys: [THREAD_LOAD_OLDER_KEY, '$thread-root', ...replies],
        thread: true,
        rootHeight: 1200,
        initialScrollTop,
      });
      const paragraphY = () => getTileY('$thread-root') + 360;
      expect(paragraphY()).toBe(expectedParagraphY);
      expect(getTileY('$reply-0')).toBeGreaterThan(VIEWPORT_HEIGHT);

      await flushKeys([
        THREAD_LOAD_OLDER_KEY,
        '$thread-root',
        ...rangeKeys('$older-', 8),
        ...replies,
      ]);
      expect(scrollElement.scrollTop).toBe(initialScrollTop);
      expect(paragraphY()).toBe(expectedParagraphY);
    }
  );

  it('keeps scrollTop at 500 when a 120 px thread header pushes the first reply off screen at y=660', async () => {
    const replies = rangeKeys('$reply-', 40);
    const { scrollElement, flushKeys, getTileY } = await mountTimeline({
      initialKeys: [THREAD_LOAD_OLDER_KEY, '$thread-root', ...replies],
      thread: true,
      headerHeight: 120,
      rootHeight: 1000,
      initialScrollTop: 500,
    });
    const rootYBefore = getTileY('$thread-root');
    expect(getTileY('$reply-0')).toBe(660);
    expect(getTileY('$reply-0')).toBeGreaterThan(VIEWPORT_HEIGHT);

    await flushKeys([
      THREAD_LOAD_OLDER_KEY,
      '$thread-root',
      ...rangeKeys('$older-', 10),
      ...replies,
    ]);
    expect(scrollElement.scrollTop).toBe(500);
    expect(getTileY('$thread-root')).toBe(rootYBefore);
  });

  it('keeps the first message at y=22 when useVirtualPaginator widens backward at scrollTop=0', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setNavigator(SAFARI_MAC_UA, 'MacIntel', 0);
    vi.stubGlobal('ResizeObserver', NoopObserver);
    vi.stubGlobal('IntersectionObserver', NoopObserver);
    const allRows = rangeKeys('$ev-', 80);
    let totalHeight = 41 * ROW_HEIGHT;
    const scrollElement = createScrollElement(() => totalHeight, 1000);
    const root = mountRoot(scrollElement);

    const mounted: {
      virtualizer?: ReturnType<typeof useTimelineScrollLedgerController>['virtualizer'];
      range?: { start: number; end: number };
    } = {};

    function PaginatedRoomHarness() {
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
        anchorSkipLeading: 1,
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
      const tileHeight = (key: string) =>
        key === ROOM_INTRO_KEY ? EXPAND_ALL_LINE_ESTIMATE_PX : ROW_HEIGHT;
      return (
        <div ref={controller.virtualInnerRef} style={{ position: 'relative', height: totalHeight }}>
          {range.start > 0 && (
            <div
              ref={(el) => {
                if (el) {
                  el.getBoundingClientRect = () =>
                    makeRect(-holdOffset - scrollElement.scrollTop, 1);
                }
                paginator.observeBackAnchor(el);
              }}
              style={{ position: 'absolute', top: -holdOffset, height: 1 }}
            />
          )}
          {renderTiles(
            controller.virtualizer.getVirtualItems(),
            controller.measureElement,
            tileHeight
          )}
        </div>
      );
    }

    flushSync(() => root.render(<PaginatedRoomHarness />));
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

  const runDirectVirtualizerPrepend = (extra?: {
    anchorTo?: 'start' | 'end';
    anchorSkipLeading?: number;
  }) => {
    const baseRows = rangeKeys('$ev-', 12);
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
      ...extra,
      observeElementRect,
      observeElementOffset,
      scrollToFn: elementScroll,
    });
    const virtualizer = new Virtualizer(opts());
    dispose = virtualizer._didMount();
    virtualizer._willUpdate();
    totalHeight = virtualizer.getTotalSize();
    const rawItem1 = (virtualizer as unknown as { _singleLaneMeasurements: { items: unknown[] } })
      ._singleLaneMeasurements.items[1];
    keys = [ROOM_INTRO_KEY, '$older-0', '$older-1', '$older-2', ...baseRows];
    virtualizer.setOptions(opts());
    totalHeight = virtualizer.getTotalSize();
    virtualizer._willUpdate();
    return { scrollElement, virtualizer, rawItem1 };
  };

  it('anchors on item 1 even when single-lane lazy measurements have not materialized index 1', () => {
    const { scrollElement, virtualizer, rawItem1 } = runDirectVirtualizerPrepend({
      anchorSkipLeading: 1,
    });
    expect(rawItem1).toBe('$ev-0');
    expect(scrollElement.scrollTop).toBe(300);
    const ev0 = virtualizer.getVirtualItems().find((item) => item.key === '$ev-0');
    expect(ev0!.start - scrollElement.scrollTop).toBe(22);
  });

  it('defaults anchorSkipLeading to 0 (upstream behaviour: anchors on item 0)', () => {
    const { scrollElement } = runDirectVirtualizerPrepend();
    expect(scrollElement.scrollTop).toBe(0);
  });

  it('does not adjust scrollTop on anchorTo: start even with anchorSkipLeading set', async () => {
    expect(
      runDirectVirtualizerPrepend({ anchorTo: 'start', anchorSkipLeading: 1 }).scrollElement
        .scrollTop
    ).toBe(0);
    const rows = rangeKeys('$ev-', 40);
    const { scrollElement, flushKeys } = await mountTimeline({
      initialKeys: [ROOM_INTRO_KEY, ...rows],
      initialScrollTop: 0,
      latestAtTop: true,
    });
    await flushKeys([ROOM_INTRO_KEY, ...rangeKeys('$inserted-', 8), ...rows]);
    expect(scrollElement.scrollTop).toBe(0);
  });

  it('keeps scroll offset put on a same-count reorder moving the first content row to the end', async () => {
    const rows = rangeKeys('$ev-', 50);
    const { scrollElement, flushKeys } = await mountTimeline({
      initialKeys: [ROOM_INTRO_KEY, ...rows],
      initialScrollTop: 20,
    });
    await flushKeys([ROOM_INTRO_KEY, ...rows.slice(1), rows[0]!]);
    expect(scrollElement.scrollTop).toBe(20);
  });
});
