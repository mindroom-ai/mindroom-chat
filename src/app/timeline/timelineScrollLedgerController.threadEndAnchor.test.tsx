// @vitest-environment jsdom
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { _resetIOSDetectionForTests } from '@tanstack/react-virtual';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readVirtualizerHoldOffset,
  useTimelineScrollLedgerController,
} from './timelineScrollLedgerController';
import {
  useRoomFocusScrollController,
  type ScrollToBottomState,
} from './roomFocusScrollController';
import { useThreadBackPaginationController } from './threadBackPaginationController';
import { useViewScopedFlag } from './roomTimelineViewScope';
import { useGestureBottomPins, useThreadOpenedAtLatest } from './roomTimelineScroll';
import { useTimelineLiveEnd } from './timelineLiveEnd';
import type { ThreadTargetCommands } from '../threads/open/threadSessionTypes';

const ROW_HEIGHT = 100;
const VIEWPORT_HEIGHT = 600;
const HEADER_PX = 120;
const COMPOSER_PX = 120;
const REAL_BOTTOM = HEADER_PX + 50 * ROW_HEIGHT + COMPOSER_PX - VIEWPORT_HEIGHT;
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';
const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const stubUserAgent = (userAgent: string, platform: string, maxTouchPoints: number) => {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', {
    value: maxTouchPoints,
    configurable: true,
  });
  _resetIOSDetectionForTests();
};

const noTargets: ThreadTargetCommands = {
  getPending: () => undefined,
  queue: () => undefined,
  complete: () => undefined,
  discard: () => undefined,
  advanceAttempt: () => undefined,
  wakeRetry: () => undefined,
};

describe('thread end-anchoring delegates bottom-following to the thread pin hooks', () => {
  let dispose: (() => void) | undefined;
  const origUA = navigator.userAgent;
  const origPlatform = navigator.platform;
  const origTouchPoints = navigator.maxTouchPoints;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.useRealTimers();
    stubUserAgent(origUA, origPlatform, origTouchPoints);
    document.body.replaceChildren();
  });

  const mountThread = async (initialScrollTop?: number) => {
    const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const prevActEnv = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;

    const mounted: {
      virtualizer?: ReturnType<typeof useTimelineScrollLedgerController>['virtualizer'];
    } = {};
    let renderedListHeight = 0;

    const scrollElement = document.createElement('div');
    scrollElement.scrollTop = initialScrollTop ?? 0;
    Object.defineProperties(scrollElement, {
      clientWidth: { value: 390, configurable: true },
      clientHeight: { value: VIEWPORT_HEIGHT, configurable: true },
      offsetWidth: { value: 390, configurable: true },
      offsetHeight: { value: VIEWPORT_HEIGHT, configurable: true },
      scrollHeight: {
        get: () => HEADER_PX + renderedListHeight + COMPOSER_PX,
        configurable: true,
      },
    });
    scrollElement.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === 'object' && options.top !== undefined) {
        const max = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
        scrollElement.scrollTop = Math.min(Math.max(0, options.top), max);
      }
    });
    document.body.appendChild(scrollElement);

    const root = createRoot(scrollElement);
    dispose = () => {
      flushSync(() => root.unmount());
      reactGlobal.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    };

    const pins: { current: ScrollToBottomState } = { current: { count: 0, smooth: false } };
    const initialKeys = Array.from({ length: 50 }, (_, i) => `$m-${i}`);

    function ThreadHarness({
      keys,
      openPending,
      tick,
    }: {
      keys: string[];
      openPending: boolean;
      tick: number;
    }) {
      void tick;
      const scrollRef = useRef<HTMLDivElement | null>(scrollElement);
      const alive = useCallback(() => true, []);
      const getScrollElement = useCallback(() => scrollElement, []);
      const backController = useThreadBackPaginationController();
      const readerScrolledRef = useViewScopedFlag('!room:example.org|$thread-1');
      const [, forceRender] = useReducer((v: number) => v + 1, 0);
      const opened = useThreadOpenedAtLatest('!room:example.org|$thread-1', openPending);
      const { startOpen } = opened;
      useEffect(() => startOpen(), [startOpen]);

      const controller = useTimelineScrollLedgerController({
        estimateSize: () => ROW_HEIGHT,
        getItemKey: (index) => keys[index] ?? index,
        getScrollElement,
        itemCount: keys.length,
        roomId: '!room:example.org',
        threadId: '$thread-1',
      });
      mounted.virtualizer = controller.virtualizer;
      renderedListHeight = controller.virtualizer.getTotalSize();
      controller.virtualizer.getVirtualItems();

      const gesturePins = useGestureBottomPins({
        backController,
        scrollToBottomRef: pins,
        readerScrolledRef,
        onFirstGesture: forceRender,
        onThreadTakeover: () => controller.virtualizer.cancelScroll(),
      });

      const scrollThreadToEnd = useCallback(
        (smooth = false) => {
          controller.virtualizer.scrollToEnd({ behavior: smooth ? 'smooth' : 'auto' });
        },
        [controller.virtualizer]
      );

      useRoomFocusScrollController({
        alive,
        atBottomAnchorRef: { current: null },
        focusScrollResetToken: '!room:example.org',
        threadTargets: noTargets,
        pendingThreadOpenTick: 0,
        retryPagination: () => undefined,
        roomId: '!room:example.org',
        scrollRef,
        scrollThreadToEnd,
        scrollToBottomRef: pins,
        scrollToElement: () => false,
        scrollToItem: () => false,
        setAtBottom: () => undefined,
        setFocusItem: () => undefined,
        suppressFocusPaginationRef: { current: false },
        isThreadOpenBottomPinSuppressed: backController.isOpenBottomPinSuppressed,
        requestThreadOpenBottomPin: () => backController.requestOpenBottomPin(pins),
        cancelThreadOpenBottomPin: gesturePins.onThreadGesture,
        shouldApplyThreadBottomPin: gesturePins.shouldApplyBottomPin,
        threadEventIndexMapRef: { current: new Map(keys.map((id, i) => [id, i])) },
        threadEventsLength: keys.length,
        threadFilteredEvents: [],
        threadFilteredEventsRef: { current: [] },
        threadId: '$thread-1',
        threadInitialRenderMode: 'live',
        threadLatestOpenPending: opened.latestOpenPending,
        threadOpenedAtLatest: opened.openedAtLatest,
        threadUserScrolled: readerScrolledRef.current.value,
        threadTimelineTick: 0,
        timelineAtLiveEnd: true,
        readMeasurementCorrectionPx: controller.readMeasurementCorrectionPx,
      });

      useTimelineLiveEnd({
        surface: readerScrolledRef.current.value ? 'thread' : undefined,
        itemCount: keys.length,
        virtualizer: controller.virtualizer,
        opensAtLatest: true,
        roomId: '!room:example.org',
        scrollElement,
        scrollToBottomRef: pins,
        committedView: '!room:example.org|$thread-1|threaded',
        focusItem: undefined,
        onReaderGesture: gesturePins.onRoomGesture,
      });

      return <div ref={controller.virtualInnerRef} style={{ height: renderedListHeight }} />;
    }

    let tick = 0;
    let currentKeys = initialKeys;
    const render = (keys = currentKeys, openPending = false) => {
      currentKeys = keys;
      tick += 1;
      flushSync(() =>
        root.render(<ThreadHarness keys={keys} openPending={openPending} tick={tick} />)
      );
    };
    render(initialKeys, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    render(initialKeys, true);
    render(initialKeys, false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (initialScrollTop !== undefined) {
      scrollElement.dispatchEvent(new Event('pointerdown'));
      scrollElement.scrollTop = initialScrollTop;
      scrollElement.dispatchEvent(new Event('scroll'));
      render(initialKeys, false);
    } else {
      scrollElement.dispatchEvent(new Event('scroll'));
      render(initialKeys, false);
    }

    return {
      scrollElement,
      pins,
      initialKeys,
      render,
      getVirtualizer: () => {
        if (!mounted.virtualizer) throw new Error('Virtualizer never mounted');
        return mounted.virtualizer;
      },
    };
  };

  it('does not pull a reader 120px above the real bottom when the last reply grows by 200px', async () => {
    const readerTop = REAL_BOTTOM - 120;
    const { scrollElement, getVirtualizer, render } = await mountThread(readerTop);
    expect(scrollElement.scrollTop).toBe(4520);

    getVirtualizer().resizeItem(49, ROW_HEIGHT + 200);
    render();

    expect(scrollElement.scrollTop).toBe(4520);
  });

  it('follows a growing last reply while the opening pin is active', async () => {
    const { scrollElement, getVirtualizer, render } = await mountThread();
    expect(scrollElement.scrollTop).toBe(4640);

    getVirtualizer().resizeItem(49, ROW_HEIGHT + 200);
    render();

    expect(scrollElement.scrollTop).toBe(4840);
  });

  it('unfolds a visible row in place at the bottom after a click releases the pin', async () => {
    const { scrollElement, getVirtualizer, render } = await mountThread();
    expect(scrollElement.scrollTop).toBe(4640);

    // Clicking a visible tool block fires pointerdown and releases the bottom pin.
    scrollElement.dispatchEvent(new Event('pointerdown'));
    render();

    getVirtualizer().resizeItem(49, ROW_HEIGHT + 200);
    render();

    expect(scrollElement.scrollTop).toBe(4640);
  });

  it('follows live-reply growth while latest-row pin holds, then unfolds in place after a click', async () => {
    const { scrollElement, pins, getVirtualizer, render } = await mountThread();
    scrollElement.dispatchEvent(new Event('pointerdown'));
    render();

    // A live reply / send activates the latest-row pin.
    pins.current = { count: pins.current.count + 1, smooth: false };
    render();
    expect(scrollElement.scrollTop).toBe(4640);

    getVirtualizer().resizeItem(49, ROW_HEIGHT + 200);
    render();
    expect(scrollElement.scrollTop).toBe(4840);

    // Clicking a visible row releases the pin; subsequent expansion unfolds in place.
    scrollElement.dispatchEvent(new Event('pointerdown'));
    render();
    getVirtualizer().resizeItem(49, ROW_HEIGHT + 400);
    render();
    expect(scrollElement.scrollTop).toBe(4840);
  });

  it('keeps key-based prepend anchoring while scrolled 120px above the real bottom', async () => {
    const readerTop = REAL_BOTTOM - 120;
    const { scrollElement, initialKeys, render } = await mountThread(readerTop);
    expect(scrollElement.scrollTop).toBe(4520);

    const prepended = [...Array.from({ length: 10 }, (_, i) => `$older-${i}`), ...initialKeys];
    render(prepended);

    expect(scrollElement.scrollTop).toBe(4520 + 10 * ROW_HEIGHT);
  });

  it('does not apply pastEndCorrection in threads when collapsing a visible penultimate reply', async () => {
    const { scrollElement, getVirtualizer, render } = await mountThread();
    const v = getVirtualizer();
    // Release the opening pin, expand penultimate row 48 to 720px (row 49 is 80px), and position
    // row 48 at viewport y = 120px (scrollTop = 4800, document y = HEADER_PX + 4800 = 4920).
    scrollElement.dispatchEvent(new Event('pointerdown'));
    v.resizeItem(48, 720);
    v.resizeItem(49, 80);
    render();
    scrollElement.scrollTop = 4800;
    scrollElement.dispatchEvent(new Event('scroll'));
    render();
    expect(HEADER_PX + 4800 - scrollElement.scrollTop).toBe(120);

    // Collapsing row 48 from 720px -> 120px (-600px) must not run pastEndCorrection and push it
    // offscreen to 720px; the browser's own max-scroll clamp leaves it visible at 280px.
    v.resizeItem(48, 120);
    render();
    const maxScrollAfter = Math.max(0, scrollElement.scrollHeight - VIEWPORT_HEIGHT);
    const clampedTop = Math.min(scrollElement.scrollTop, maxScrollAfter);
    const visualTopAfter = HEADER_PX + 4800 - clampedTop;
    expect(scrollElement.scrollTop).toBe(4800);
    expect(visualTopAfter).toBe(280);
  });

  it('keeps iOS _holdOffset open while fling moves scrollTop without scroll events, then flushes from live', async () => {
    stubUserAgent(IPHONE_UA, 'iPhone', 5);
    const { scrollElement, getVirtualizer } = await mountThread(2000);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const v = getVirtualizer();

    scrollElement.dispatchEvent(new Event('touchstart'));
    scrollElement.scrollTop = 1900;
    scrollElement.dispatchEvent(new Event('scroll'));
    v.resizeItem(5, ROW_HEIGHT + 200);
    expect(readVirtualizerHoldOffset(v)).toBe(200);
    // Let observeOffset debounce settle while finger is down so only the touchend tail timer runs.
    vi.advanceTimersByTime(160);
    scrollElement.dispatchEvent(new Event('touchend'));

    // Fling advances upward by 20px with no scroll event; visual offset of row 20 is now 120px.
    scrollElement.scrollTop = 1880;
    const row20VisualBeforeFlush =
      v.getVirtualItems().find((item) => item.index === 20)!.start - scrollElement.scrollTop;

    // Tail must stay open rather than flushing mid-fling.
    vi.advanceTimersByTime(150);
    expect(readVirtualizerHoldOffset(v)).toBe(200);
    expect(scrollElement.scrollTop).toBe(1880);

    // Once scrollTop settles for 150ms, hold flushes from live (1880 + 200 = 2080, not stale 2100).
    vi.advanceTimersByTime(150);
    expect(readVirtualizerHoldOffset(v)).toBe(0);
    expect(scrollElement.scrollTop).toBe(2080);
    expect(
      v.getVirtualItems().find((item) => item.index === 20)!.start - scrollElement.scrollTop
    ).toBe(row20VisualBeforeFlush);
  });

  it('rebases cleanly from live on quiet iOS tail close and preserves pre-touch clamped shortfall', async () => {
    stubUserAgent(IPHONE_UA, 'iPhone', 5);
    const { scrollElement, getVirtualizer, render } = await mountThread(2000);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const v = getVirtualizer();

    // Part 1: sub-1px quiet-tail drift without a scroll event rebases from live on tail close.
    scrollElement.dispatchEvent(new Event('touchstart'));
    scrollElement.scrollTop = 1900;
    scrollElement.dispatchEvent(new Event('scroll'));
    v.resizeItem(5, ROW_HEIGHT + 200);
    expect(readVirtualizerHoldOffset(v)).toBe(200);
    vi.advanceTimersByTime(160);
    scrollElement.dispatchEvent(new Event('touchend'));

    scrollElement.scrollTop = 1899.5;
    const row20VisualBeforeFlush =
      v.getVirtualItems().find((item) => item.index === 20)!.start - scrollElement.scrollTop;
    vi.advanceTimersByTime(150);
    expect(readVirtualizerHoldOffset(v)).toBe(0);
    expect(scrollElement.scrollTop).toBe(2099.5);
    expect(
      v.getVirtualItems().find((item) => item.index === 20)!.start - scrollElement.scrollTop
    ).toBe(row20VisualBeforeFlush);

    // Part 2: pre-touch clamped adjustment shortfall at maxScroll survives the iOS live rebase.
    const maxAtBottom = scrollElement.scrollHeight - scrollElement.clientHeight;
    scrollElement.scrollTop = maxAtBottom;
    scrollElement.dispatchEvent(new Event('scroll'));
    render();
    vi.advanceTimersByTime(200);

    const rowNode = document.createElement('div');
    rowNode.dataset.index = '10';
    Object.defineProperty(rowNode, 'offsetHeight', { value: ROW_HEIGHT + 50, configurable: true });
    scrollElement.appendChild(rowNode);
    v.measureElement(rowNode);
    expect(scrollElement.scrollTop).toBe(maxAtBottom);
    expect((v as unknown as { _clampedAdjustment: unknown })._clampedAdjustment).toEqual({
      target: maxAtBottom + 50,
      maxAtWrite: maxAtBottom,
    });

    scrollElement.dispatchEvent(new Event('touchstart'));
    v.resizeItem(4, ROW_HEIGHT + 50);
    expect(readVirtualizerHoldOffset(v)).toBe(50);
    scrollElement.dispatchEvent(new Event('touchend'));

    vi.advanceTimersByTime(150);
    expect(readVirtualizerHoldOffset(v)).toBe(0);
    expect(scrollElement.scrollTop).toBe(maxAtBottom + 100);
  });

  it('reconciles an unseen live scrollTop move during iOS lateFling before applyScrollAdjustment', async () => {
    stubUserAgent(IPHONE_UA, 'iPhone', 5);
    const { scrollElement, getVirtualizer } = await mountThread(1100);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const v = getVirtualizer();

    scrollElement.dispatchEvent(new Event('touchstart'));
    scrollElement.scrollTop = 1000;
    scrollElement.dispatchEvent(new Event('scroll'));
    scrollElement.dispatchEvent(new Event('touchend'));
    vi.advanceTimersByTime(150);

    const gesture = (
      v as unknown as { _iosGesture: { touch: { phase: string } | null; inMotion: () => boolean } }
    )._iosGesture;
    expect(gesture.touch?.phase).toBe('lateFling');
    expect(gesture.inMotion()).toBe(false);
    expect(readVirtualizerHoldOffset(v)).toBe(0);

    scrollElement.scrollTop = 960;
    v.resizeItem(2, ROW_HEIGHT + 80);
    expect(scrollElement.scrollTop).toBe(1040);
  });

  it('reconciles a direct scrollTop mutation before scroll event in applyScrollAdjustment on desktop', async () => {
    stubUserAgent(DESKTOP_CHROME_UA, 'MacIntel', 0);
    const { scrollElement, getVirtualizer } = await mountThread(1000);
    const v = getVirtualizer();

    scrollElement.scrollTop += 200;
    v.resizeItem(2, ROW_HEIGHT - 20);
    expect(scrollElement.scrollTop).toBe(1180);
  });
});
