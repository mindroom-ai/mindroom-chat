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

/**
 * `listEndShrinkPx` plays the rendered rows: how much higher the list will end once React renders
 * it, when they already show the measured row at its new size.
 */
const makeTimeline = (
  scrollTop: number,
  ios = false,
  listEndShrinkPx?: (index: number) => number | undefined
) => {
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
  let unrenderedEndPx = 0;
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = buildMeasurementScrollCorrectionHook({
    isIOSWebKitDevice: () => ios,
    onDroppedCorrection: () => {},
    onAppliedCorrection: (deltaPx, atEnd) => {
      unrenderedPx += deltaPx;
      if (atEnd) unrenderedEndPx += deltaPx;
    },
    unrenderedCorrectionPx: () => unrenderedPx,
    unrenderedEndCorrectionPx: () => unrenderedEndPx,
    listEndShrinkPx,
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

// virtual-core's cache can hold sizes React never rendered: the newest row's growth renders after
// the paint, and a row mounted while the list held its height never lengthened it. The rendered
// rows tell where the list will end.

it('leaves a reader at the end the rendered rows show when the row grew without a render first', () => {
  // The finished reply grew 38 px in virtual-core's cache only, then shrank to 24 px under what the
  // list rendered; a follow to the end already took those 24 px.
  const { element, scrollToFn, virtualizer } = makeTimeline(END - 24, false, () => 24);
  virtualizer.resizeItem(COUNT - 1, ROW + 38);
  virtualizer.resizeItem(COUNT - 1, ROW - 24);
  expect(scrollToFn).not.toHaveBeenCalled();
  expect(element.scrollTop).toBe(END - 24);
});

it('takes no correction for a row whose estimate the rendered list never counted', () => {
  const { scrollToFn, virtualizer } = makeTimeline(END, false, () => 0);
  virtualizer.resizeItem(COUNT - 1, 0);
  expect(scrollToFn).not.toHaveBeenCalled();
});

it('keeps the end where the rendered rows show it when the newest row shrinks', () => {
  const { element, virtualizer } = makeTimeline(END, false, () => 60);
  virtualizer.resizeItem(COUNT - 1, ROW - 60);
  expect(element.scrollTop).toBe(END - 60);
});

it('counts a shrink once when two rows the rendered list already shows shrink in one frame', () => {
  // The reply and a hidden row after it: the rendered rows show both shrinks at each measurement.
  const { element, virtualizer } = makeTimeline(END, false, () => 92);
  virtualizer.resizeItem(COUNT - 2, ROW - 62);
  virtualizer.resizeItem(COUNT - 1, ROW - 30);
  expect(element.scrollTop).toBe(END - 92);
});

it('adds a row above that shrank before the rows it moves were rendered', () => {
  // A row far above shrinks (its correction moves the reader before React moves the rows under
  // it), then the newest row shrinks in the same frame.
  const { element, virtualizer } = makeTimeline(END, false, (index) =>
    index === COUNT - 1 ? 62 : undefined
  );
  virtualizer.resizeItem(0, ROW - 96);
  virtualizer.resizeItem(COUNT - 1, ROW - 62);
  expect(element.scrollTop).toBe(END - 158);
});

it('puts a reader just above the end where the browser will clamp them', () => {
  const { element, virtualizer } = makeTimeline(END - 20, false, () => 60);
  virtualizer.resizeItem(COUNT - 1, ROW - 60);
  expect(element.scrollTop).toBe(END - 60);
});
