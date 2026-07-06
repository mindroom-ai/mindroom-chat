// @vitest-environment jsdom
//
// iOS scroll contract for the timeline virtualizer, against the REAL
// (unmocked, locally patched) @tanstack/virtual-core.
//
// iOS kills flick momentum on any programmatic scroll write issued while a
// scroll is live, and replayed corrections at quiescence land as a visible
// lurch. The physics only reproduces on a device, but the CAUSE is fully
// observable here: every write goes through scrollToFn. These tests pin the
// invariant that keeps the device behavior correct:
//
//   while scroll events are streaming on iOS, the virtualizer must issue
//   ZERO scroll writes for measurement corrections, and must have NOTHING
//   banked to replay when the stream ends.
//
// The "detector" test proves the harness would catch the device bug it was
// born from (task #128 round 3: half-page lurch at end of momentum from
// virtual-core's banked defer-and-replay).
import { Virtualizer, _resetIOSDetectionForTests } from '@tanstack/react-virtual';
import { describe, expect, it, vi } from 'vitest';
import { buildMeasurementScrollCorrectionHook } from './threadRenderUtils';

const ROW_ESTIMATE = 50;
const ROW_ACTUAL = 120;
const COUNT = 200;
const START_OFFSET = 5000;
const FLICKS = 3;
const STEPS_PER_FLICK = 10;
const MEASURED_ROWS = FLICKS * STEPS_PER_FLICK;
const BANKED_ERROR = MEASURED_ROWS * (ROW_ACTUAL - ROW_ESTIMATE);

// virtual-core caches its iOS detection at module scope; jsdom's userAgent
// lives on the prototype, so an own property shadows it (same pattern as
// virtual-core's own test suite).
function withFakeIOSUserAgent<T>(fn: () => T): T {
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    configurable: true,
  });
  _resetIOSDetectionForTests();
  try {
    return fn();
  } finally {
    delete (navigator as { userAgent?: string }).userAgent;
    _resetIOSDetectionForTests();
  }
}

type ScrollCallback = (offset: number, isScrolling: boolean) => void;

// virtual-core keeps its banked iOS adjustment compile-time private; the
// contract must observe it (same escape hatch virtual-core's own tests use).
const bankedAdjustment = (virtualizer: Virtualizer<Element, Element>): number =>
  (virtualizer as unknown as { _iosDeferredAdjustment: number })._iosDeferredAdjustment;

function makeVirtualizer(scrollToFn: ReturnType<typeof vi.fn>) {
  let scrollCallback: ScrollCallback | null = null;
  const makeScrollElement = () => ({
    scrollTop: START_OFFSET,
    scrollLeft: 0,
    scrollHeight: COUNT * ROW_ESTIMATE,
    clientHeight: 600,
    offsetHeight: 600,
  });
  const holder = { element: makeScrollElement() };
  const virtualizer = new Virtualizer<Element, Element>({
    count: COUNT,
    estimateSize: () => ROW_ESTIMATE,
    getScrollElement: () => holder.element as unknown as Element,
    scrollToFn,
    observeElementRect: () => {},
    observeElementOffset: (_instance, cb) => {
      scrollCallback = cb;
      cb(START_OFFSET, false);
      return () => {};
    },
  });
  virtualizer._willUpdate();
  // Build the measurements cache so resizeItem can resolve items.
  virtualizer.getTotalSize();
  // _willUpdate issues a mount-sync write; the tests only care about
  // measurement-correction writes after this point.
  scrollToFn.mockClear();
  const scroll: ScrollCallback = (offset, isScrolling) => scrollCallback!(offset, isScrolling);
  // A new element identity makes the next _willUpdate run cleanup() and
  // re-attach — what a thread switch's scroller remount does in the app.
  const swapToFreshElement = () => {
    holder.element = makeScrollElement();
    virtualizer._willUpdate();
  };
  return { virtualizer, scroll, swapToFreshElement };
}

const adjustmentWrites = (scrollToFn: ReturnType<typeof vi.fn>) =>
  scrollToFn.mock.calls.filter(
    ([, options]) => (options as { adjustments?: number } | undefined)?.adjustments !== undefined
  );

// An upward multi-flick gesture through never-measured territory: scroll
// events stream (isScrolling stays true across the flick boundaries, as on
// a device where the finger comes back down within the debounce window)
// while each newly mounted above-viewport row measures BIGGER than its
// estimate — the exact shape of the device report.
function runUpwardFlickSequence(virtualizer: Virtualizer<Element, Element>, scroll: ScrollCallback) {
  let offset = START_OFFSET;
  let index = Math.floor(START_OFFSET / ROW_ESTIMATE) - 1;
  for (let flick = 0; flick < FLICKS; flick += 1) {
    for (let step = 0; step < STEPS_PER_FLICK; step += 1) {
      offset -= 40;
      scroll(offset, true);
      virtualizer.resizeItem(index, ROW_ACTUAL);
      index -= 1;
    }
  }
  return offset;
}

describe('virtualizer iOS scroll contract (production hook)', () => {
  it('issues no scroll writes during the stream and banks nothing to replay at quiescence', () => {
    withFakeIOSUserAgent(() => {
      const scrollToFn = vi.fn();
      const { virtualizer, scroll } = makeVirtualizer(scrollToFn);
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook(
        {
          isIOSWebKitDevice: () => true,
          hasActiveTouches: () => false,
        }
      );

      const endOffset = runUpwardFlickSequence(virtualizer, scroll);
      expect(scrollToFn).not.toHaveBeenCalled();
      expect(bankedAdjustment(virtualizer)).toBe(0);

      // Momentum dies: still nothing to write — no end-of-momentum lurch.
      scroll(endOffset, false);
      expect(scrollToFn).not.toHaveBeenCalled();

      // Measurements were APPLIED, not deferred (the PR #76 white-gap
      // failure mode stays dead): total size reflects the real row heights.
      expect(virtualizer.getTotalSize()).toBe(COUNT * ROW_ESTIMATE + BANKED_ERROR);
    });
  });

  it('detector: without the hook, virtual-core banks the whole gesture and replays it as one lurch', () => {
    withFakeIOSUserAgent(() => {
      const scrollToFn = vi.fn();
      const { virtualizer, scroll } = makeVirtualizer(scrollToFn);

      const endOffset = runUpwardFlickSequence(virtualizer, scroll);
      expect(scrollToFn).not.toHaveBeenCalled();
      expect(bankedAdjustment(virtualizer)).toBe(BANKED_ERROR);

      scroll(endOffset, false);
      expect(scrollToFn).toHaveBeenCalledTimes(1);
      const [, options] = scrollToFn.mock.calls[0] as [
        number,
        { adjustments?: number; behavior?: ScrollBehavior },
      ];
      expect(options.adjustments).toBe(BANKED_ERROR);
    });
  });

  it('applies above-viewport corrections immediately once the iOS scroller is quiet', () => {
    withFakeIOSUserAgent(() => {
      const scrollToFn = vi.fn();
      const { virtualizer, scroll } = makeVirtualizer(scrollToFn);
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook(
        {
          isIOSWebKitDevice: () => true,
          hasActiveTouches: () => false,
        }
      );

      scroll(START_OFFSET, false);
      virtualizer.resizeItem(10, ROW_ACTUAL);
      expect(scrollToFn).toHaveBeenCalledTimes(1);
      const [, options] = scrollToFn.mock.calls[0] as [
        number,
        { adjustments?: number; behavior?: ScrollBehavior },
      ];
      expect(options.adjustments).toBe(ROW_ACTUAL - ROW_ESTIMATE);
    });
  });

  it('never compensates a visible (straddling) row resize — expanding a tool block must not scroll the view', () => {
    withFakeIOSUserAgent(() => {
      const scrollToFn = vi.fn();
      const { virtualizer, scroll } = makeVirtualizer(scrollToFn);
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook(
        {
          isIOSWebKitDevice: () => true,
          hasActiveTouches: () => false,
        }
      );

      // Quiet viewport whose top edge sits INSIDE row 100 (start 5000):
      // the row straddles the viewport top, exactly like a tall tool-call
      // block whose expand/fold control is on screen.
      scroll(START_OFFSET + 25, false);

      // Expand: the block grows by 400px. The content must unfold in place —
      // no compensating write now, and nothing banked to land 150ms later.
      virtualizer.resizeItem(100, ROW_ESTIMATE + 400);
      expect(scrollToFn).not.toHaveBeenCalled();
      expect(bankedAdjustment(virtualizer)).toBe(0);

      // Fold back: same contract in the other direction.
      virtualizer.resizeItem(100, ROW_ESTIMATE);
      expect(scrollToFn).not.toHaveBeenCalled();
      expect(bankedAdjustment(virtualizer)).toBe(0);
    });
  });

  it('patch guard: cleanup() resets banked iOS deferral state on scroll-element swap', () => {
    // Pins the patch-package fix for TanStack/virtual#1220
    // (patches/@tanstack+virtual-core+3.17.3.patch). If a dependency bump
    // drops the patch without the upstream fix present, the stale bank
    // survives the swap and this fails.
    withFakeIOSUserAgent(() => {
      const scrollToFn = vi.fn();
      const { virtualizer, scroll, swapToFreshElement } = makeVirtualizer(scrollToFn);

      runUpwardFlickSequence(virtualizer, scroll);
      expect(bankedAdjustment(virtualizer)).toBe(BANKED_ERROR);

      // Thread switch mid-flick: the scroller remounts while a deferral is
      // banked. The bank was computed against the OLD element's content and
      // must not survive into the new one.
      swapToFreshElement();
      expect(bankedAdjustment(virtualizer)).toBe(0);

      // The new element's first quiescence must not replay a stale delta.
      scroll(START_OFFSET, false);
      expect(adjustmentWrites(scrollToFn)).toHaveLength(0);
    });
  });

  it('keeps mid-scroll anchoring off iOS (desktop wheel has no momentum to protect)', () => {
    const scrollToFn = vi.fn();
    const { virtualizer, scroll } = makeVirtualizer(scrollToFn);
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook({
      isIOSWebKitDevice: () => false,
      hasActiveTouches: () => false,
    });

    scroll(START_OFFSET - 40, true);
    virtualizer.resizeItem(10, ROW_ACTUAL);
    expect(scrollToFn).toHaveBeenCalledTimes(1);
  });
});
