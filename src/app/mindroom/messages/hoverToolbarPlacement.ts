import { type RefObject, useLayoutEffect, useRef, useState } from 'react';

/**
 * Whether focus that just landed on `target` came from the keyboard. A click on a message gives
 * focus to its row as well; the browser marks only keyboard focus `:focus-visible`.
 */
export const isKeyboardFocus = (target: EventTarget | null): boolean => {
  if (!target || typeof (target as Element).matches !== 'function') return false;
  try {
    return (target as Element).matches(':focus-visible');
  } catch {
    // Engines without the selector: count the focus, as before.
    return true;
  }
};

const scrollsVertically = (element: Element): boolean => {
  const { overflowY } = getComputedStyle(element);
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
};

/** The nearest ancestor that scrolls the row. */
const findScroller = (row: HTMLElement): HTMLElement | undefined => {
  for (let node = row.parentElement; node; node = node.parentElement) {
    if (scrollsVertically(node)) return node;
  }
  return undefined;
};

/** Marks a control that floats over the top rows of a timeline, such as the `[+all]` toggle. */
export const TIMELINE_OVERLAY_ATTRIBUTE = 'data-timeline-overlay';
// Space kept between such a control and a toolbar moved below it: twice the toolbar's own 4 px
// padding, so the control does not read as part of the toolbar.
const OVERLAY_GAP_PX = 8;

/**
 * The lowest point of what floats over the top of a scroller where a toolbar spanning `left` to
 * `right` would sit: the scroller's `scroll-padding-top`, which the timeline sets to the height
 * of the floating room header and the sticky thread banner, and the controls that float below
 * them.
 */
const coveredUntilY = (scroller: HTMLElement, left: number, right: number): number => {
  const inset = Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop);
  let bottom = scroller.getBoundingClientRect().top + (Number.isFinite(inset) ? inset : 0);
  scroller.querySelectorAll(`[${TIMELINE_OVERLAY_ATTRIBUTE}]`).forEach((overlay) => {
    const rect = overlay.getBoundingClientRect();
    if (rect.width > 0 && rect.left < right && rect.right > left) {
      bottom = Math.max(bottom, rect.bottom + OVERLAY_GAP_PX);
    }
  });
  return bottom;
};

/**
 * How far below the top of its row the hover toolbar has to sit to stay clear of what floats
 * over the top of the timeline, in pixels, or `undefined` when its usual place above the row is
 * clear. The first row of a thread starts right under the banner and its `[+all]` toggle, so
 * its toolbar moves down into the row instead of covering them. Measured while the toolbar
 * shows, and again as the timeline scrolls under it.
 */
export const useToolbarClearance = (
  rowRef: RefObject<HTMLElement>,
  toolbarRef: RefObject<HTMLElement>,
  shown: boolean
): number | undefined => {
  const [clearance, setClearance] = useState<number>();
  const clearanceRef = useRef<number>();
  clearanceRef.current = clearance;
  // The toolbar's usual offset from the top of its row, measured while it sits there.
  const usualOffset = useRef<number>();

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!shown || !row || typeof row.getBoundingClientRect !== 'function') {
      setClearance(undefined);
      return undefined;
    }
    const scroller = findScroller(row);
    if (!scroller) return undefined;
    let frame = 0;
    const place = () => {
      frame = 0;
      const toolbar = toolbarRef.current;
      if (!toolbar) return;
      const rowTop = row.getBoundingClientRect().top;
      const bar = toolbar.getBoundingClientRect();
      if (clearanceRef.current === undefined) usualOffset.current = bar.top - rowTop;
      const needed = coveredUntilY(scroller, bar.left, bar.right) - rowTop;
      const next = needed > (usualOffset.current ?? 0) + 0.5 ? Math.round(needed) : undefined;
      if (next !== clearanceRef.current) setClearance(next);
    };
    place();
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [rowRef, toolbarRef, shown]);

  return clearance;
};
