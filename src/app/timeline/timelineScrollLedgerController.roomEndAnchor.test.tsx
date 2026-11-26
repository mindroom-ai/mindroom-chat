// @vitest-environment jsdom
import { useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { _resetIOSDetectionForTests } from '@tanstack/react-virtual';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROOM_INTRO_KEY } from './roomTimelineRows';
import { useTimelineRowJumps } from './roomTimelineScroll';
import { useTimelineLiveEnd } from './timelineLiveEnd';
import {
  readVirtualizerHoldOffset,
  useTimelineScrollLedgerController,
} from './timelineScrollLedgerController';

const ROW_HEIGHT = 100;
const INTRO_ESTIMATE_PX = 160.5;
const VIEWPORT_HEIGHT = 600;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15';
const CHROME_MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const stubUserAgent = (userAgent: string) => {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
};

type ObservedResize = {
  callback: ResizeObserverCallback;
  targets: Set<Element>;
};

const installControllableResizeObserver = () => {
  const instances: ObservedResize[] = [];
  class StubResizeObserver {
    private readonly record: ObservedResize;
    constructor(callback: ResizeObserverCallback) {
      this.record = { callback, targets: new Set() };
      instances.push(this.record);
    }
    observe(target: Element) {
      this.record.targets.add(target);
    }
    unobserve(target: Element) {
      this.record.targets.delete(target);
    }
    disconnect() {
      this.record.targets.clear();
    }
  }
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  const fireRowBatch = (entries: { target: Element; height: number }[]) => {
    const observer = instances.find((inst) => entries.every((e) => inst.targets.has(e.target)));
    if (!observer) throw new Error('No ResizeObserver observing batch targets');
    const roEntries = entries.map(({ target, height }) => {
      Object.defineProperty(target, 'offsetHeight', { value: height, configurable: true });
      target.getBoundingClientRect = () => ({
        top: 0,
        bottom: height,
        left: 0,
        right: 390,
        width: 390,
        height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      return {
        target,
        borderBoxSize: [{ blockSize: height, inlineSize: 390 }],
        contentRect: { height, width: 390 },
      } as unknown as ResizeObserverEntry;
    });
    observer.callback(roEntries, observer as unknown as ResizeObserver);
  };
  return { fireRowBatch };
};

describe('oldest-first room anchoring with real virtualizer', () => {
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

  const mountRoom = async ({
    initialKeys = Array.from({ length: 40 }, (_, i) => `$ev-${i}`),
    initialScrollTop = 1200,
    withRowJumps = false,
    canLoadOlder = false,
  }: {
    initialKeys?: string[];
    initialScrollTop?: number;
    withRowJumps?: boolean;
    canLoadOlder?: boolean;
  } = {}) => {
    const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const prevActEnv = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;

    const { fireRowBatch } = installControllableResizeObserver();
    let totalHeight = initialKeys.length * ROW_HEIGHT;
    const scrollWrites: number[] = [];

    const scrollElement = document.createElement('div');
    scrollElement.scrollTop = initialScrollTop;
    Object.defineProperties(scrollElement, {
      clientWidth: { value: 390, configurable: true },
      clientHeight: { value: VIEWPORT_HEIGHT, configurable: true },
      offsetWidth: { value: 390, configurable: true },
      offsetHeight: { value: VIEWPORT_HEIGHT, configurable: true },
      scrollHeight: {
        get: () => totalHeight,
        configurable: true,
      },
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
        const clamped = Math.min(Math.max(0, options.top), max);
        scrollWrites.push(clamped);
        scrollElement.scrollTop = clamped;
      }
    });
    document.body.appendChild(scrollElement);

    const root = createRoot(scrollElement);
    dispose = () => {
      flushSync(() => root.unmount());
      reactGlobal.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    };

    const mounted: {
      virtualizer?: ReturnType<typeof useTimelineScrollLedgerController>['virtualizer'];
      jumps?: ReturnType<typeof useTimelineRowJumps>;
    } = {};
    const pins = { current: { count: 0, smooth: false } };

    function RoomHarness({ keys, tick }: { keys: string[]; tick: number }) {
      void tick;
      const getScrollElement = useCallback(() => scrollElement, []);
      const controller = useTimelineScrollLedgerController({
        estimateSize: (index = 0) =>
          keys[index] === ROOM_INTRO_KEY ? INTRO_ESTIMATE_PX : ROW_HEIGHT,
        getItemKey: (index) => keys[index] ?? index,
        getScrollElement,
        itemCount: keys.length,
        canLoadOlder,
        roomId: '!room:example.org',
      });
      mounted.virtualizer = controller.virtualizer;
      totalHeight = controller.virtualizer.getTotalSize();

      const activeRangeRef = useRef({ start: 0, end: keys.length });
      activeRangeRef.current = { start: 0, end: keys.length };
      const virtualizerRef = useRef(controller.virtualizer);
      virtualizerRef.current = controller.virtualizer;
      const threadEventIndexMapRef = useRef(new Map<string, number>());
      const roomRowsRef = useRef(keys.map((id) => ({ getId: () => id })));
      roomRowsRef.current = keys.map((id) => ({ getId: () => id }));

      const jumps = useTimelineRowJumps({
        paginatorScrollToItem: () => false,
        paginatorScrollToElement: () => true,
        activeRangeRef,
        virtualizerRef,
        threadEventIndexMapRef,
        rows: {
          getScrollElement,
          getRowElement: () => undefined,
          roomRowsRef,
        },
      });
      if (withRowJumps) mounted.jumps = jumps;

      useTimelineLiveEnd({
        surface: 'room',
        itemCount: keys.length,
        virtualizer: controller.virtualizer,
        opensAtLatest: false,
        roomId: '!room:example.org',
        scrollElement,
        scrollToBottomRef: pins,
        committedView: '!room:example.org|classic',
        focusItem: undefined,
        onReaderGesture: () => undefined,
      });

      const items = controller.virtualizer.getVirtualItems();
      return (
        <div ref={controller.virtualInnerRef} style={{ position: 'relative', height: totalHeight }}>
          {items.map((item) => (
            <div
              key={String(item.key)}
              data-index={item.index}
              data-key={String(item.key)}
              ref={(node) => {
                if (node && !Object.prototype.hasOwnProperty.call(node, 'offsetHeight')) {
                  Object.defineProperty(node, 'offsetHeight', {
                    value: item.key === ROOM_INTRO_KEY ? 160 : ROW_HEIGHT,
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
      flushSync(() => root.render(<RoomHarness keys={currentKeys} tick={tick} />));
    };

    render();
    await Promise.resolve();
    scrollElement.scrollTop = initialScrollTop;
    scrollElement.dispatchEvent(new Event('scroll'));
    render();
    await Promise.resolve();
    scrollWrites.length = 0;

    return {
      scrollElement,
      scrollWrites,
      pins,
      fireRowBatch,
      render,
      getVirtualizer: () => mounted.virtualizer!,
      getJumps: () => mounted.jumps!,
      getTileTop: (key: string) => {
        const el = scrollElement.querySelector<HTMLElement>(`[data-key="${key}"]`);
        return el ? Number.parseFloat(el.style.top) : undefined;
      },
    };
  };

  it('compensates a two-row ResizeObserver batch above the viewport at rest', async () => {
    const { scrollElement, fireRowBatch, getVirtualizer, getTileTop } = await mountRoom({
      initialScrollTop: 1200,
    });
    const row8 = scrollElement.querySelector('[data-index="8"]')!;
    const row9 = scrollElement.querySelector('[data-index="9"]')!;
    expect(row8).not.toBeNull();
    expect(row9).not.toBeNull();

    // Pre-measure both above-viewport rows into itemSizeCache at ROW_HEIGHT.
    getVirtualizer().itemSizeCache.set('$ev-8', ROW_HEIGHT);
    getVirtualizer().itemSizeCache.set('$ev-9', ROW_HEIGHT);
    const visualBefore = getTileTop('$ev-12')! - scrollElement.scrollTop;

    // One ResizeObserver batch reports both rows growing (+60 and +80 = +140).
    fireRowBatch([
      { target: row8, height: ROW_HEIGHT + 60 },
      { target: row9, height: ROW_HEIGHT + 80 },
    ]);

    expect(scrollElement.scrollTop).toBe(1340);
    expect(getTileTop('$ev-12')! - scrollElement.scrollTop).toBe(visualBefore);
  });

  it('anchors a scrolled reader without jumping when roomIntro prepends as virtual item 0', async () => {
    const initialKeys = Array.from({ length: 40 }, (_, i) => `$ev-${i}`);
    const { scrollElement, render, getTileTop } = await mountRoom({
      initialKeys,
      initialScrollTop: 800,
    });
    const visualBefore = getTileTop('$ev-8')! - scrollElement.scrollTop;

    // Reaching the start of the room prepends ROOM_INTRO_KEY at index 0.
    render([ROOM_INTRO_KEY, ...initialKeys]);

    expect(scrollElement.scrollTop).toBeCloseTo(800 + INTRO_ESTIMATE_PX, 1);
    expect(getTileTop('$ev-8')! - scrollElement.scrollTop).toBeCloseTo(visualBefore, 1);
  });

  it('applies above-viewport resizes immediately during Chromium wheel without wheel-hold', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubUserAgent(CHROME_MAC_UA);
    const { scrollElement, fireRowBatch, getVirtualizer, getTileTop } = await mountRoom({
      initialScrollTop: 1200,
    });
    const v = getVirtualizer();
    const row8 = scrollElement.querySelector('[data-index="8"]')!;
    const row9 = scrollElement.querySelector('[data-index="9"]')!;
    v.itemSizeCache.set('$ev-8', ROW_HEIGHT);
    v.itemSizeCache.set('$ev-9', ROW_HEIGHT);
    const visualBefore = getTileTop('$ev-12')! - scrollElement.scrollTop;

    scrollElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -40 }));
    fireRowBatch([
      { target: row8, height: ROW_HEIGHT + 60 },
      { target: row9, height: ROW_HEIGHT + 80 },
    ]);

    expect(readVirtualizerHoldOffset(v)).toBe(0);
    expect(scrollElement.scrollTop).toBe(1340);
    expect(getTileTop('$ev-12')! - scrollElement.scrollTop).toBe(visualBefore);
  });

  it('clamps negative _holdOffset on flush so reaching scrollTop=0 never snaps rows upward', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubUserAgent(IPHONE_UA);
    _resetIOSDetectionForTests();
    const initialKeys = Array.from({ length: 40 }, (_, i) => `$ev-${i}`);
    const { scrollElement, render, getVirtualizer, getTileTop } = await mountRoom({
      initialKeys,
      initialScrollTop: 1200,
      canLoadOlder: true,
    });
    const v = getVirtualizer();
    const anchorVisualBeforeResize = getTileTop('$ev-12')! - scrollElement.scrollTop;

    // Row 0 (above scrollTop=1200) shrinks by -80px during an active iOS touch drag.
    scrollElement.dispatchEvent(new Event('touchstart'));
    v.resizeItem(0, 20);
    expect(readVirtualizerHoldOffset(v)).toBe(-80);
    expect(getTileTop('$ev-12')! - scrollElement.scrollTop).toBe(anchorVisualBeforeResize);

    // User scrolls up to scrollTop=30 while -80 is still held (live + hold = -50 < 0).
    scrollElement.scrollTop = 30;
    scrollElement.dispatchEvent(new Event('scroll'));
    render();
    const row1VisualAt30 = getTileTop('$ev-1')! - scrollElement.scrollTop;

    // Ending the touch flushes only -30 to scrollTop=0, leaving -50 held with 0px visual snap.
    scrollElement.dispatchEvent(new Event('touchend'));
    vi.advanceTimersByTime(200);
    expect(scrollElement.scrollTop).toBe(0);
    expect(readVirtualizerHoldOffset(v)).toBe(-50);
    expect(getTileTop('$ev-1')! - scrollElement.scrollTop).toBe(row1VisualAt30);

    // Another touch at scrollTop=0 keeps -50 held rather than snapping rows by -50px.
    scrollElement.dispatchEvent(new Event('touchstart'));
    scrollElement.dispatchEvent(new Event('touchend'));
    vi.advanceTimersByTime(200);
    expect(scrollElement.scrollTop).toBe(0);
    expect(readVirtualizerHoldOffset(v)).toBe(-50);
    expect(getTileTop('$ev-1')! - scrollElement.scrollTop).toBe(row1VisualAt30);

    // When an older page prepends (+1000px), the remaining -50 hold drains cleanly to 0 with 0px snap.
    render([...Array.from({ length: 10 }, (_, i) => `$older-${i}`), ...initialKeys]);
    expect(readVirtualizerHoldOffset(v)).toBe(0);
    expect(scrollElement.scrollTop).toBe(950);
    expect(getTileTop('$ev-1')! - scrollElement.scrollTop).toBe(row1VisualAt30);
  });
});
