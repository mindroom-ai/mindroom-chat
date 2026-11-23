import { describe, expect, it } from 'vitest';
import {
  computePaintedItemEnd,
  computeTrimPlan,
  type ResizeQueueEntry,
} from './threadHeadroomOwner';

describe('computePaintedItemEnd', () => {
  it('keeps pre-batch item.end unchanged when measurementsCache has not been rebuilt (cold open 21->41 batch)', () => {
    // Reproduces the exact ref-attach batch from cold open (mid-thread) at threadCount 21->41:
    // idx 13 (-256), idx 14 (+28), idx 18 (-230), then idx 19 (+28, end 49145 <= readerTop 49437).
    // @tanstack/virtual-core does not rebuild measurementsCache between resizeItem calls, so
    // cached sizes still equal oldSize and idx 19 must still classify as above readerTop.
    const measurementsCache = Array.from({ length: 25 }, (_, i) => ({ key: `$e${i}`, size: 0 }));
    measurementsCache[13] = { key: '$e13', size: 970 };
    measurementsCache[14] = { key: '$e14', size: 50 };
    measurementsCache[18] = { key: '$e18', size: 944 };
    measurementsCache[19] = { key: '$e19', size: 50 };

    const queue: ResizeQueueEntry[] = [
      { seq: 1, delta: -256, itemIndex: 13, itemKey: '$e13', oldSize: 970 },
      { seq: 2, delta: 28, itemIndex: 14, itemKey: '$e14', oldSize: 50 },
      { seq: 3, delta: -230, itemIndex: 18, itemKey: '$e18', oldSize: 944 },
    ];

    const paintedEnd = computePaintedItemEnd({
      item: { index: 19, end: 49145 },
      aboveResizeQueue: queue,
      measurementsCache,
    });
    expect(paintedEnd).toBe(49145);
    expect(paintedEnd <= 49437).toBe(true);
  });

  it('subtracts only the shift already reflected in a rebuilt measurementsCache', () => {
    // Suppose idx 13 grew +500 (970 -> 1470) and getMeasurements() rebuilt measurementsCache
    // before React updated scrollMargin, shifting idx 19.end from 49145 to 49645 (> 49437).
    const measurementsCache = Array.from({ length: 25 }, (_, i) => ({ key: `$e${i}`, size: 0 }));
    measurementsCache[13] = { key: '$e13', size: 1470 };
    measurementsCache[19] = { key: '$e19', size: 50 };

    const queue: ResizeQueueEntry[] = [
      { seq: 1, delta: 500, itemIndex: 13, itemKey: '$e13', oldSize: 970 },
    ];

    const paintedEnd = computePaintedItemEnd({
      item: { index: 19, end: 49645 },
      aboveResizeQueue: queue,
      measurementsCache,
    });
    expect(paintedEnd).toBe(49145);
    expect(paintedEnd <= 49437).toBe(true);
  });

  it('uses the earliest oldSize when the same row resizes twice before commit', () => {
    const measurementsCache = Array.from({ length: 20 }, (_, i) => ({ key: `$e${i}`, size: 0 }));
    measurementsCache[13] = { key: '$e13', size: 700 };

    const queue: ResizeQueueEntry[] = [
      { seq: 1, delta: -256, itemIndex: 13, itemKey: '$e13', oldSize: 970 },
      { seq: 2, delta: -14, itemIndex: 13, itemKey: '$e13', oldSize: 714 },
    ];

    expect(
      computePaintedItemEnd({
        item: { index: 19, end: 49145 - 270 },
        aboveResizeQueue: queue,
        measurementsCache,
      })
    ).toBe(49145);
  });

  it('ignores entries whose key no longer matches measurementsCache at itemIndex', () => {
    const measurementsCache = Array.from({ length: 20 }, (_, i) => ({ key: `$new${i}`, size: 500 }));
    const queue: ResizeQueueEntry[] = [
      { seq: 1, delta: 400, itemIndex: 13, itemKey: '$old13', oldSize: 100 },
    ];

    expect(
      computePaintedItemEnd({
        item: { index: 19, end: 49145 },
        aboveResizeQueue: queue,
        measurementsCache,
      })
    ).toBe(49145);
  });
});

describe('computeTrimPlan', () => {
  it('never moves visible rows at scrollTop=0 when unused wrap cushion sits above visible row 0', () => {
    // Reproduces LEDGER-BOUNDARY: mobile viewport 844px, scrollTop=0, 608px cushion remaining
    // with row 0 visible at y=608. Trimming 608->0 would jump visible row 0 up by 608px.
    expect(
      computeTrimPlan({
        headroomPx: 608,
        scrollTop: 0,
        viewHeight: 844,
        viewWidth: 390,
        unmeasuredAbove: 0,
      })
    ).toBeUndefined();
  });

  it('trims only invisible reserve space above the viewport when reserve and real rows are both visible', () => {
    // scrollTop=200, headroomPx=608, viewHeight=844: [0, 200) is above viewport, [200, 608) is
    // visible reserve, [608, 844) is visible real rows. Trimming 200 pairs headroom 608->408 with
    // scrollTop 200->0 for 0px visible row movement.
    expect(
      computeTrimPlan({
        headroomPx: 608,
        scrollTop: 200,
        viewHeight: 844,
        viewWidth: 390,
        unmeasuredAbove: 0,
      })
    ).toEqual({
      nextHeadroom: 408,
      trim: 200,
      targetScrollTop: 0,
    });
  });

  it('trims the remaining cushion once the reader leaves the top (scrollTop >= headroomPx)', () => {
    expect(
      computeTrimPlan({
        headroomPx: 608,
        scrollTop: 700,
        viewHeight: 844,
        viewWidth: 390,
        unmeasuredAbove: 0,
      })
    ).toEqual({
      nextHeadroom: 0,
      trim: 608,
      targetScrollTop: 92,
    });
  });

  it('reveals row 0 when the entire viewport sits strictly inside the reserve (Home / thumb drag)', () => {
    expect(
      computeTrimPlan({
        headroomPx: 4190,
        scrollTop: 0,
        viewHeight: 900,
        viewWidth: 1440,
        unmeasuredAbove: 0,
      })
    ).toEqual({
      nextHeadroom: 0,
      trim: 4190,
      targetScrollTop: 0,
    });
  });
});
