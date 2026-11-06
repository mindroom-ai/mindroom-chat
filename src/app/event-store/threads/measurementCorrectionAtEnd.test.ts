// @vitest-environment jsdom
import { Virtualizer } from '@tanstack/react-virtual';
import { expect, it, vi } from 'vitest';
import { buildMeasurementScrollCorrectionHook } from './threadRenderUtils';

// A row that shrinks while the reader is at the end of the list, against the real virtual-core.
// The list keeps its rendered height until React renders the new one, so without a correction the
// shrink opens a blank band under the newest row for a frame and the browser then clamps the
// whole timeline down. The correction keeps the end in place in the same frame.

const ROW = 100;
const COUNT = 30;
const VIEWPORT = 600;
// The timeline pads its end by the footer's height.
const PADDING = 120;

const makeTimeline = (scrollTop: number, ios = false) => {
  const element = {
    scrollTop,
    scrollLeft: 0,
    scrollHeight: COUNT * ROW + PADDING,
    clientHeight: VIEWPORT,
    offsetHeight: VIEWPORT,
  };
  const scrollToFn = vi.fn((offset: number, options: { adjustments?: number }) => {
    element.scrollTop = offset + (options.adjustments ?? 0);
  });
  const virtualizer = new Virtualizer<Element, Element>({
    count: COUNT,
    estimateSize: () => ROW,
    getScrollElement: () => element as unknown as Element,
    scrollToFn,
    observeElementRect: () => {},
    observeElementOffset: (_instance, callback) => {
      callback(scrollTop, false);
      return () => {};
    },
  });
  virtualizer._willUpdate();
  virtualizer.getTotalSize();
  scrollToFn.mockClear();
  let unrenderedPx = 0;
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook({
    isIOSWebKitDevice: () => ios,
    onDroppedCorrection: () => {},
    onAppliedCorrection: (deltaPx) => {
      unrenderedPx += deltaPx;
    },
    unrenderedCorrectionPx: () => unrenderedPx,
  });
  return { element, scrollToFn, virtualizer };
};

const END = COUNT * ROW + PADDING - VIEWPORT;

it('keeps the end in place when the newest row shrinks under a reader at the end', () => {
  const { element, virtualizer } = makeTimeline(END);
  virtualizer.resizeItem(COUNT - 1, ROW - 60);
  expect(element.scrollTop).toBe(END - 60);
});

it('moves a reader just above the end by the whole shrink, keeping their distance to it', () => {
  const { element, virtualizer } = makeTimeline(END - 20);
  virtualizer.resizeItem(COUNT - 1, ROW - 60);
  expect(element.scrollTop).toBe(END - 80);
});

it('keeps the end through two shrinks in one frame, before React renders either', () => {
  const { element, virtualizer } = makeTimeline(END);
  virtualizer.resizeItem(COUNT - 1, ROW - 60);
  virtualizer.resizeItem(COUNT - 2, ROW - 30);
  expect(element.scrollTop).toBe(END - 90);
});

it('lets a row shrink in place for a reader further from the end than the shrink', () => {
  const { scrollToFn, virtualizer } = makeTimeline(END - 200);
  virtualizer.resizeItem(COUNT - 1, ROW - 60);
  expect(scrollToFn).not.toHaveBeenCalled();
});

it('lets a row grow in place at the end', () => {
  const { scrollToFn, virtualizer } = makeTimeline(END);
  virtualizer.resizeItem(COUNT - 1, ROW + 60);
  expect(scrollToFn).not.toHaveBeenCalled();
});

it('leaves the clamp to the browser on iOS', () => {
  const { scrollToFn, virtualizer } = makeTimeline(END, true);
  virtualizer.resizeItem(COUNT - 1, ROW - 60);
  expect(scrollToFn).not.toHaveBeenCalled();
});
