// @vitest-environment jsdom
//
// Ledger settle contract against the REAL (unmocked) @tanstack/virtual-core.
//
// The settle folds the offset ledger in one synchronous block: clear the
// inner margin, shift scrollTop, zero virtual-core's scrollMargin. The
// scrollTop write's echo event is asynchronous (iOS may coalesce it away),
// so the window recompute inside that block must see a reconciled cached
// offset — otherwise it pairs the zeroed margin with the pre-write offset
// and shifts the computed range by the whole fold, mounting and measuring a
// band of far-away rows in a single frame (the settle-cascade jump: up to
// +1,531px content growth right after rest; ride-traces 1783802452438 /
// 1783804190290, pinned in rideTraceReplay.test.ts).
//
// These tests execute the PRODUCTION settle sequence (applyLedgerSettle)
// against real virtual-core range math — the sufficiency check the fake
// virtualizer in the lifecycle suite cannot provide. The detector test
// proves the harness would catch the defect it was born from.
import { Virtualizer } from '@tanstack/react-virtual';
import { describe, expect, it } from 'vitest';
import { applyLedgerSettle } from './timelineScrollLedgerController';

const ROW_ESTIMATE = 50;
const COUNT = 400;
const START_OFFSET = 5000;
// Trace-shaped fold: the frame-192 settle rebased ~3.4k px.
const FOLD_PX = 3400;
const VIEWPORT = { width: 400, height: 600 };

function makeSettledScroller() {
  const element = {
    scrollTop: START_OFFSET,
    scrollLeft: 0,
    scrollHeight: COUNT * ROW_ESTIMATE,
    clientHeight: VIEWPORT.height,
    offsetHeight: VIEWPORT.height,
  };
  // Accrual state: the ledger holds FOLD_PX (scrollMargin -FOLD_PX shifts
  // every measurement start up) while the cached offset still reflects the
  // last real scroll event.
  const virtualizer = new Virtualizer<Element, Element>({
    count: COUNT,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 1,
    scrollMargin: -FOLD_PX,
    getScrollElement: () => element as unknown as Element,
    scrollToFn: () => {},
    observeElementRect: (_instance, cb) => {
      cb(VIEWPORT);
    },
    observeElementOffset: (_instance, cb) => {
      cb(START_OFFSET, false);
    },
  });
  virtualizer._willUpdate();
  virtualizer.getTotalSize();
  const inner = { style: { marginTop: `-${FOLD_PX}px` } };
  return { virtualizer, element, inner };
}

const rangeOf = (virtualizer: Virtualizer<Element, Element>): [number, number] => {
  const items = virtualizer.getVirtualItems();
  return [items[0].index, items[items.length - 1].index];
};

describe('ledger settle contract (real virtual-core)', () => {
  it('keeps the computed window identical across the production settle block', () => {
    const { virtualizer, element, inner } = makeSettledScroller();
    const before = rangeOf(virtualizer);

    const settledScrollTop = applyLedgerSettle(inner, element, FOLD_PX, virtualizer);

    expect(settledScrollTop).toBe(START_OFFSET + FOLD_PX);
    expect(virtualizer.scrollOffset).toBe(START_OFFSET + FOLD_PX);
    expect(inner.style.marginTop).toBe('');
    expect(virtualizer.options.scrollMargin).toBe(0);
    // The window the settle-triggered recompute renders is the SAME rows —
    // no far-away band gets mounted and measured inside the settle frame.
    expect(rangeOf(virtualizer)).toEqual(before);
  });

  it('detector: without the offset reconcile, the recompute shifts the window by the fold', () => {
    const { virtualizer, element, inner } = makeSettledScroller();
    const before = rangeOf(virtualizer);

    // The pre-fix settle: margin cleared, scrollTop written, margin zeroed —
    // but the cached offset left stale until the (async) echo event.
    inner.style.marginTop = '';
    element.scrollTop += FOLD_PX;
    virtualizer.setOptions({ ...virtualizer.options, scrollMargin: 0 });

    const [beforeStart] = before;
    const [afterStart] = rangeOf(virtualizer);
    expect(beforeStart - afterStart).toBe(FOLD_PX / ROW_ESTIMATE);
  });
});
