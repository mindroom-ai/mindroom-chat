// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { Virtualizer } from '@tanstack/virtual-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  THREAD_SCROLL_OWNER_FLAG,
  computeAverageMeasuredRowHeight,
  computeHeadroomBudget,
  computeHeadroomRenderSnapshot,
  computePaintedItemEnd,
  computeTrimPlan,
  createThreadScrollOwnerState,
  isThreadScrollOwnerEnabled,
  resolveReserveEntryTarget,
  type ResizeQueueEntry,
} from './threadScrollHeadroom';
import { NOOP_THREAD_SCROLL_TO_FN } from './threadScrollWriter';
import { useListEndClamp } from './useListEndClamp';
import { useFooterBottomPin } from './useFooterBottomPin';
import { useFollowContentGrowth } from './useFollowContentGrowth';

describe('threadScrollHeadroom invariants', () => {
  afterEach(() => {
    window.localStorage.removeItem(THREAD_SCROLL_OWNER_FLAG);
  });

  it('is OFF by default and respects the localStorage flag', () => {
    expect(isThreadScrollOwnerEnabled()).toBe(false);
    window.localStorage.setItem(THREAD_SCROLL_OWNER_FLAG, '1');
    expect(isThreadScrollOwnerEnabled()).toBe(true);
    window.localStorage.setItem(THREAD_SCROLL_OWNER_FLAG, '0');
    expect(isThreadScrollOwnerEnabled()).toBe(false);
  });

  it('keeps pre-batch painted item.end exact across unrebuilt and rebuilt virtualizer caches', () => {
    const unrebuilt = Array.from({ length: 25 }, (_, i) => ({ key: `$e${i}`, size: 0 }));
    unrebuilt[13] = { key: '$e13', size: 970 };
    unrebuilt[14] = { key: '$e14', size: 50 };
    unrebuilt[18] = { key: '$e18', size: 944 };
    unrebuilt[19] = { key: '$e19', size: 50 };
    const queue: ResizeQueueEntry[] = [
      { seq: 1, delta: -256, itemIndex: 13, itemKey: '$e13', oldSize: 970 },
      { seq: 2, delta: 28, itemIndex: 14, itemKey: '$e14', oldSize: 50 },
      { seq: 3, delta: -230, itemIndex: 18, itemKey: '$e18', oldSize: 944 },
    ];
    expect(
      computePaintedItemEnd({
        item: { index: 19, end: 49145 },
        aboveResizeQueue: queue,
        measurementsCache: unrebuilt,
      })
    ).toBe(49145);

    const rebuilt = Array.from({ length: 25 }, (_, i) => ({ key: `$e${i}`, size: 0 }));
    rebuilt[13] = { key: '$e13', size: 1470 };
    rebuilt[19] = { key: '$e19', size: 50 };
    expect(
      computePaintedItemEnd({
        item: { index: 19, end: 49645 },
        aboveResizeQueue: [{ seq: 1, delta: 500, itemIndex: 13, itemKey: '$e13', oldSize: 970 }],
        measurementsCache: rebuilt,
      })
    ).toBe(49145);
  });

  it('never moves visible rows during rest trim and reveals row 0 when strictly inside reserve', () => {
    expect(
      computeTrimPlan({
        headroomPx: 3000,
        scrollTop: 0,
        viewHeight: 900,
        viewWidth: 1440,
        unmeasuredAbove: 0,
      })
    ).toEqual({ nextHeadroom: 0, trim: 3000, targetScrollTop: 0 });

    // Partial reserve plus visible rows at scrollTop = 0: must not move visible rows.
    expect(
      computeTrimPlan({
        headroomPx: 600,
        scrollTop: 0,
        viewHeight: 844,
        viewWidth: 390,
        unmeasuredAbove: 0,
      })
    ).toBeUndefined();

    // Partial reserve plus visible rows with invisible space above viewport: trim only [0, scrollTop).
    expect(
      computeTrimPlan({
        headroomPx: 600,
        scrollTop: 180,
        viewHeight: 844,
        viewWidth: 390,
        unmeasuredAbove: 0,
      })
    ).toEqual({ nextHeadroom: 420, trim: 180, targetScrollTop: 0 });

    // Entire reserve above viewport and nearTop: trim headroom and shift scrollTop equally.
    expect(
      computeTrimPlan({
        headroomPx: 600,
        scrollTop: 900,
        viewHeight: 900,
        viewWidth: 1440,
        unmeasuredAbove: 0,
      })
    ).toEqual({ nextHeadroom: 0, trim: 600, targetScrollTop: 300 });

    // Far from top: never trim.
    expect(
      computeTrimPlan({
        headroomPx: 600,
        scrollTop: 5000,
        viewHeight: 900,
        viewWidth: 1440,
        unmeasuredAbove: 0,
      })
    ).toBeUndefined();
  });

  it('absorbs prepends and above-reader growth into headroom and clamps at 0 without writing scroll', () => {
    const state = createThreadScrollOwnerState([]);
    state.committedHeadroomPx = 1000;
    state.aboveResizeQueue = [
      { seq: 1, delta: 150 },
      { seq: 2, delta: -50 },
    ];
    expect(
      computeHeadroomRenderSnapshot(state, {
        ownerEnabled: true,
        resettingLedgerView: false,
        prependFoldPx: 400,
        leadingFoldPx: 50,
      })
    ).toEqual({ headroomPxAtRender: 450, renderedResizeSeq: 2 });

    state.committedHeadroomPx = 80;
    state.aboveResizeQueue = [{ seq: 3, delta: 200 }];
    expect(
      computeHeadroomRenderSnapshot(state, {
        ownerEnabled: true,
        resettingLedgerView: false,
        prependFoldPx: 0,
        leadingFoldPx: 0,
      })
    ).toEqual({ headroomPxAtRender: 0, renderedResizeSeq: 3 });
  });

  it('computes average row height including 0-height folded rows and isolates reserve-entry policy', () => {
    const avg = computeAverageMeasuredRowHeight(undefined, 180, [
      { key: 'a', size: 200 },
      { key: 'b', size: 0 },
      { key: 'c', size: 0 },
      { key: 'd', size: 200 },
    ]);
    expect(avg).toBe(100);
    expect(
      computeHeadroomBudget({
        unloadedReplies: 0,
        avgRowHeight: avg,
        viewHeight: 900,
        hasMoreHistory: true,
      })
    ).toBe(3600);
    expect(resolveReserveEntryTarget(200, 1000, 'glide')).toBeUndefined();
    expect(resolveReserveEntryTarget(200, 1000, 'clamp')).toBe(1000);
  });

  it('keeps real @tanstack/virtual-core strictly read-only during resizeItem', () => {
    const scroller = document.createElement('div');
    Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
    let writes = 0;
    let top = 1200;
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => top,
      set: (value: number) => {
        writes += 1;
        top = value;
      },
      configurable: true,
    });
    const queuedDeltas: number[] = [];
    const virtualizer = new Virtualizer<HTMLDivElement, Element>({
      count: 20,
      getScrollElement: () => scroller,
      estimateSize: () => 100,
      scrollMargin: 500,
      scrollToFn: NOOP_THREAD_SCROLL_TO_FN,
      observeElementRect: (_instance, cb) => {
        cb({ width: 400, height: 600 });
      },
      observeElementOffset: (_instance, cb) => {
        cb(top, false);
      },
    });
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, delta) => {
      if (item.end <= top) queuedDeltas.push(delta);
      return false;
    };
    const cleanup = virtualizer._didMount();
    virtualizer._willUpdate();
    virtualizer.resizeItem(1, 240);
    cleanup();

    expect(writes).toBe(0);
    expect(queuedDeltas).toEqual([140]);
  });

  it('attaches zero ResizeObservers in legacy hooks when gated off', () => {
    const originalRO = globalThis.ResizeObserver;
    const roConstructed = vi.fn();
    class SpyResizeObserver {
      constructor() {
        roConstructed();
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    globalThis.ResizeObserver = SpyResizeObserver;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    function Harness() {
      const scroller = React.useMemo(() => document.createElement('div'), []);
      const contentRef = React.useRef<HTMLDivElement>(document.createElement('div'));
      const probeRef = React.useRef<HTMLDivElement>(document.createElement('div'));
      const atLiveEndRef = React.useRef(true);
      const liveReplies = React.useMemo(() => ({ frameCount: () => 0 }), []);
      useListEndClamp(null, contentRef, probeRef, () => 0);
      useFooterBottomPin(null, probeRef, () => undefined);
      useFollowContentGrowth(
        () => scroller,
        contentRef,
        () => true,
        atLiveEndRef,
        liveReplies as never,
        '!room:example',
        () => 0,
        false
      );
      return null;
    }

    try {
      act(() => {
        root.render(React.createElement(Harness));
      });
      expect(roConstructed).not.toHaveBeenCalled();
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
      globalThis.ResizeObserver = originalRO;
    }
  });
});
