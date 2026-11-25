// @vitest-environment jsdom
import { useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { _resetIOSDetectionForTests } from '@tanstack/react-virtual';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXPAND_ALL_LINE_ESTIMATE_PX,
  ROOM_INTRO_ESTIMATE_PX,
  ROOM_INTRO_KEY,
} from './roomTimelineRows';
import { useLatestRowPin, useTimelineRowJumps } from './roomTimelineScroll';
import {
  readVirtualizerHoldOffset,
  useTimelineScrollLedgerController,
} from './timelineScrollLedgerController';

const ROW_HEIGHT = 100;
const VIEWPORT_HEIGHT = 600;
const SAFARI_MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

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
    latestAtTop = false,
    thread = false,
    shortHistory = false,
    initialCanLoadOlder = false,
  }: {
    initialKeys?: string[];
    initialScrollTop?: number;
    withRowJumps?: boolean;
    latestAtTop?: boolean;
    thread?: boolean;
    shortHistory?: boolean;
    initialCanLoadOlder?: boolean;
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

    function RoomHarness({
      keys,
      tick,
      introEstimate = ROOM_INTRO_ESTIMATE_PX,
      canLoadOlder = false,
    }: {
      keys: string[];
      tick: number;
      introEstimate?: number;
      canLoadOlder?: boolean;
    }) {
      void tick;
      const getScrollElement = useCallback(() => scrollElement, []);
      const controller = useTimelineScrollLedgerController({
        estimateSize: (index = 0) => (keys[index] === ROOM_INTRO_KEY ? introEstimate : ROW_HEIGHT),
        getItemKey: (index) => keys[index] ?? index,
        getScrollElement,
        itemCount: keys.length,
        latestAtTop,
        anchorRoomRows: latestAtTop ? () => true : undefined,
        roomId: '!room:example.org',
        threadId: thread ? '$thread-root' : undefined,
        canLoadOlder,
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

      useLatestRowPin({
        surface: thread ? 'thread' : 'room',
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
                if (node) {
                  Object.defineProperty(node, 'offsetHeight', {
                    value:
                      item.key === ROOM_INTRO_KEY
                        ? 160
                        : shortHistory && item.index >= 27 && item.index < 35
                          ? 20
                          : ROW_HEIGHT,
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
    let currentIntroEstimate = ROOM_INTRO_ESTIMATE_PX;
    let currentCanLoadOlder = initialCanLoadOlder;
    let tick = 0;
    const render = (
      nextKeys = currentKeys,
      opts?: { introEstimate?: number; canLoadOlder?: boolean }
    ) => {
      currentKeys = nextKeys;
      if (opts?.introEstimate !== undefined) currentIntroEstimate = opts.introEstimate;
      if (opts?.canLoadOlder !== undefined) currentCanLoadOlder = opts.canLoadOlder;
      tick += 1;
      flushSync(() =>
        root.render(
          <RoomHarness
            keys={currentKeys}
            tick={tick}
            introEstimate={currentIntroEstimate}
            canLoadOlder={currentCanLoadOlder}
          />
        )
      );
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

  it('shows the actual room intro after reaching history start with shrinking rows', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubUserAgent(SAFARI_MAC_UA);
    const { scrollElement, getTileTop, getVirtualizer, fireRowBatch, render } = await mountRoom({
      initialKeys: [ROOM_INTRO_KEY, ...Array.from({ length: 40 }, (_, i) => `$ev-${i}`)],
      initialScrollTop: 1200,
    });
    scrollElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -240 }));
    // Eight estimated rows above the reader turn out to be short rows (20px not 100px).
    const entries = Array.from({ length: 8 }, (_, i) => ({
      target: scrollElement.querySelector(`[data-index="${i + 2}"]`)!,
      height: 20,
    }));
    expect(entries.every((e) => !!e.target)).toBe(true);
    fireRowBatch(entries);
    expect(readVirtualizerHoldOffset(getVirtualizer())).toBe(-640);
    scrollElement.scrollTop = 0;
    scrollElement.dispatchEvent(new Event('scroll'));
    render();
    vi.advanceTimersByTime(2000);
    render();
    // No more history can prepend. Another upward wheel at zero should expose the first row.
    scrollElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -240 }));
    vi.advanceTimersByTime(2000);
    render();
    expect(getTileTop(ROOM_INTRO_KEY)).toBeLessThan(VIEWPORT_HEIGHT);
  });

  it('drops a clamped negative hold when roomIntro later mounts at rest', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubUserAgent(SAFARI_MAC_UA);
    const rows = Array.from({ length: 40 }, (_, i) => `$ev-${i}`);
    const { scrollElement, getTileTop, getVirtualizer, fireRowBatch, render } = await mountRoom({
      initialKeys: rows,
      initialScrollTop: 1200,
      initialCanLoadOlder: true,
    });
    scrollElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -240 }));
    fireRowBatch(
      Array.from({ length: 8 }, (_, i) => ({
        target: scrollElement.querySelector(`[data-index="${i + 2}"]`)!,
        height: 20,
      }))
    );
    scrollElement.scrollTop = 0;
    scrollElement.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(2000);
    // Older history can still prepend: negative hold stays clamped at rest.
    expect(readVirtualizerHoldOffset(getVirtualizer())).toBe(-640);

    // Reaching the true start of the room mounts ROOM_INTRO_KEY and drops the remaining negative hold.
    render([ROOM_INTRO_KEY, ...rows], { canLoadOlder: false });
    expect(readVirtualizerHoldOffset(getVirtualizer())).toBe(0);
    expect(getTileTop(ROOM_INTRO_KEY)).toBe(0);
  });

  it('does not write into iOS inertial scrolling when a thread gets a reply in newest-first view', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15');
    _resetIOSDetectionForTests();
    const keys = Array.from({ length: 40 }, (_, i) => `$ev-${i}`);
    const { scrollElement, render, getVirtualizer, getTileTop } = await mountRoom({
      latestAtTop: true,
      initialKeys: keys,
    });
    const inner = scrollElement.firstElementChild!;
    const rect = inner.getBoundingClientRect();
    inner.getBoundingClientRect = () => ({ ...rect, top: -scrollElement.scrollTop });
    render();

    scrollElement.dispatchEvent(new Event('touchstart'));
    scrollElement.scrollTop = 1300;
    scrollElement.dispatchEvent(new Event('scroll'));
    scrollElement.dispatchEvent(new Event('touchend'));
    expect(
      (getVirtualizer() as unknown as { _canWriteScroll: () => boolean })._canWriteScroll()
    ).toBe(false);

    render([keys[30]!, ...keys.filter((_, i) => i !== 30)]);
    // Must stay at 1300 during the iOS fling while holding +100px so row $ev-13 stays still.
    expect(scrollElement.scrollTop).toBe(1300);
    expect(readVirtualizerHoldOffset(getVirtualizer())).toBe(100);
    expect(getTileTop('$ev-13')! - scrollElement.scrollTop).toBe(0);

    // At rest (after the fling tail closes), virtual-core flushes the hold and lands at 1400.
    vi.advanceTimersByTime(500);
    expect(
      (getVirtualizer() as unknown as { _canWriteScroll: () => boolean })._canWriteScroll()
    ).toBe(true);
    expect(readVirtualizerHoldOffset(getVirtualizer())).toBe(0);
    expect(scrollElement.scrollTop).toBe(1400);
    expect(getTileTop('$ev-13')! - scrollElement.scrollTop).toBe(0);
  });

  for (const [label, toggleHeightPx] of [
    ['desktop (22px)', EXPAND_ALL_LINE_ESTIMATE_PX],
    ['touch coarse-pointer (48px)', 48],
  ] as const) {
    it(`keeps a visible row in place when item 0 grows with roomIntro on ${label}`, async () => {
      const keys = [ROOM_INTRO_KEY, ...Array.from({ length: 40 }, (_, i) => `$ev-${i}`)];
      const { scrollElement, fireRowBatch, getTileTop, render } = await mountRoom({
        initialKeys: keys,
        initialScrollTop: 800,
        initialCanLoadOlder: true,
      });
      const leadingTile = scrollElement.querySelector('[data-index="0"]')!;
      expect(leadingTile).not.toBeNull();
      // Initial item 0 mounts as [+all] alone at the platform's line height (22px desktop, 48px touch).
      fireRowBatch([{ target: leadingTile, height: toggleHeightPx }]);
      render();
      const rowYBefore = getTileTop('$ev-8')! - scrollElement.scrollTop;

      // Room intro mounts inside the same stable item 0 (+160px above the viewport).
      render(keys, { canLoadOlder: false });
      fireRowBatch([{ target: leadingTile, height: 160 + toggleHeightPx }]);
      render();
      expect(getTileTop('$ev-8')! - scrollElement.scrollTop).toBeCloseTo(rowYBefore, 0);
    });
  }

  it('shows the first reply when scrolling up to the start of an open fully-loaded thread', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubUserAgent(SAFARI_MAC_UA);
    const { scrollElement, getTileTop, getVirtualizer, render } = await mountRoom({
      thread: true,
      shortHistory: true,
      initialScrollTop: 6600,
      initialKeys: Array.from({ length: 80 }, (_, i) => `$ev-${i}`),
    });
    for (let pos = 6360; pos >= 1200; pos -= 240) {
      scrollElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -240 }));
      scrollElement.scrollTop = pos;
      scrollElement.dispatchEvent(new Event('scroll'));
      render();
      await Promise.resolve();
    }
    expect(readVirtualizerHoldOffset(getVirtualizer())).toBe(-640);
    scrollElement.scrollTop = 0;
    scrollElement.dispatchEvent(new Event('scroll'));
    render();
    vi.advanceTimersByTime(2000);
    render();
    expect(readVirtualizerHoldOffset(getVirtualizer())).toBe(0);
    expect(getTileTop('$ev-0')).toBeLessThan(VIEWPORT_HEIGHT);
  });

  it('does not write into desktop WebKit wheel scrolling when a thread gets a reply in newest-first view', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stubUserAgent(SAFARI_MAC_UA);
    _resetIOSDetectionForTests();
    const keys = Array.from({ length: 40 }, (_, i) => `$ev-${i}`);
    const { scrollElement, render, getVirtualizer, getTileTop } = await mountRoom({
      latestAtTop: true,
      initialKeys: keys,
    });
    const inner = scrollElement.firstElementChild!;
    const rect = inner.getBoundingClientRect();
    inner.getBoundingClientRect = () => ({ ...rect, top: -scrollElement.scrollTop });
    render();

    scrollElement.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    scrollElement.scrollTop = 1300;
    scrollElement.dispatchEvent(new Event('scroll'));
    render([keys[30]!, ...keys.filter((_, i) => i !== 30)]);
    // Must stay at 1300 during the live desktop wheel while holding +100px so row $ev-13 stays still.
    expect(scrollElement.scrollTop).toBe(1300);
    expect(readVirtualizerHoldOffset(getVirtualizer())).toBe(100);
    expect(getTileTop('$ev-13')! - scrollElement.scrollTop).toBe(0);

    // At rest (after the wheel timer expires), virtual-core flushes the hold and lands at 1400.
    vi.advanceTimersByTime(500);
    expect(
      (getVirtualizer() as unknown as { _canWriteScroll: () => boolean })._canWriteScroll()
    ).toBe(true);
    expect(readVirtualizerHoldOffset(getVirtualizer())).toBe(0);
    expect(scrollElement.scrollTop).toBe(1400);
    expect(getTileTop('$ev-13')! - scrollElement.scrollTop).toBe(0);
  });
});
