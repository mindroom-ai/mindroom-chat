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

/** Marks a control right above a timeline's first row, such as the `[+all]` toggle. */
export const TIMELINE_OVERLAY_ATTRIBUTE = 'data-timeline-overlay';
/**
 * The Show full message / Show less button of a long message (CollapsibleMessage). It sits at the
 * end of the message's bottom edge, the corner the toolbar of the row below floats over.
 */
const FOLD_BUTTON = '[data-message-fold] > * > [data-message-disclosure] > button';
/**
 * The sender line at the top of a message: its name, the reply details button of an agent reply
 * and the time, which the toolbar keeps clear of once it moves down into its row.
 */
const SENDER_LINE = '[data-message-sender-line]';
// Space kept between the toolbar and such controls: twice the toolbar's own 4 px padding, so a
// control does not read as part of the toolbar.
const CONTROL_GAP_PX = 8;
// The lowest a toolbar moved into its row goes: this far above the row's bottom.
const ROW_END_GAP_PX = 4;

/**
 * The lowest point of what floats over the top of a scroller where a toolbar spanning `left` to
 * `right` would sit: the scroller's `scroll-padding-top`, which the timeline sets to the height
 * of the floating room header and the sticky thread banner, and the controls right above the
 * rows.
 */
const coveredUntilY = (scroller: HTMLElement, left: number, right: number): number => {
  const inset = Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop);
  let bottom = scroller.getBoundingClientRect().top + (Number.isFinite(inset) ? inset : 0);
  scroller.querySelectorAll(`[${TIMELINE_OVERLAY_ATTRIBUTE}]`).forEach((overlay) => {
    const rect = overlay.getBoundingClientRect();
    if (rect.width > 0 && rect.left < right && rect.right > left) {
      bottom = Math.max(bottom, rect.bottom + CONTROL_GAP_PX);
    }
  });
  return bottom;
};

/** A fold button beside the toolbar, relative to the top of the toolbar's row. */
export type FoldSpan = { top: number; bottom: number; ownRow: boolean };

/**
 * Where the toolbar's top goes, relative to the top of its row, or `undefined` for its usual
 * place. `usual` is that place, `covered` where what floats over the top of the timeline ends,
 * `height` the toolbar's own height, `folds` the fold buttons under its span, and `senderLine`
 * the row's sender line where it is under the span.
 */
export const toolbarOffset = (
  usual: number,
  covered: number,
  rowHeight: number,
  height: number,
  folds: FoldSpan[],
  senderLine?: { top: number; bottom: number }
): number | undefined => {
  // Below the header and the controls under it, but no lower than 4 px above the row's bottom.
  let top = covered > usual + 0.5 ? Math.min(covered, rowHeight - ROW_END_GAP_PX - height) : usual;
  [...folds]
    .sort((a, b) => a.top - b.top)
    .forEach((fold) => {
      if (top < fold.bottom + CONTROL_GAP_PX && top + height > fold.top - CONTROL_GAP_PX) {
        // The fold button of the long message above pushes the toolbar down into its row; the
        // row's own, at its bottom, pushes it up.
        top = fold.ownRow ? fold.top - CONTROL_GAP_PX - height : fold.bottom + CONTROL_GAP_PX;
      }
    });
  // Moved down into its row, it goes on below the row's sender line where that shows, so the
  // name, the time and the reply details button stay in reach. In its usual place it ends a few
  // pixels into the row, above the line's text.
  if (
    senderLine &&
    senderLine.bottom > covered &&
    top > usual + 0.5 &&
    top < senderLine.bottom &&
    top + height > senderLine.top
  ) {
    top = senderLine.bottom + CONTROL_GAP_PX;
  }
  return Math.abs(top - usual) > 0.5 ? Math.round(top) : undefined;
};

/**
 * How far below the top of its row the hover toolbar sits, in pixels, or `undefined` in its usual
 * place above the row. It moves to stay clear of what floats over the top of the timeline (the
 * first row starts right under the `[+all]` toggle and a thread's banner, so its toolbar moves
 * down into the row instead of covering them) and of the fold buttons of long messages, so
 * it never draws over a Show less button. Moved down into its row, it also keeps below the row's
 * sender line. Measured while the toolbar shows, and again as the timeline scrolls under it or
 * the row changes size.
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
      const rowRect = row.getBoundingClientRect();
      const bar = toolbar.getBoundingClientRect();
      if (clearanceRef.current === undefined) usualOffset.current = bar.top - rowRect.top;
      const folds = Array.from(scroller.querySelectorAll(FOLD_BUTTON)).flatMap((button) => {
        const rect = button.getBoundingClientRect();
        if (!(rect.width > 0 && rect.left < bar.right && rect.right > bar.left)) return [];
        const top = rect.top - rowRect.top;
        return [{ top, bottom: top + rect.height, ownRow: row.contains(button) }];
      });
      const sender = row.querySelector(SENDER_LINE)?.getBoundingClientRect();
      const senderLine =
        sender && sender.width > 0 && sender.left < bar.right && sender.right > bar.left
          ? { top: sender.top - rowRect.top, bottom: sender.bottom - rowRect.top }
          : undefined;
      const next = toolbarOffset(
        usualOffset.current ?? 0,
        coveredUntilY(scroller, bar.left, bar.right) - rowRect.top,
        rowRect.height,
        bar.height,
        folds,
        senderLine
      );
      if (next !== clearanceRef.current) setClearance(next);
    };
    place();
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    scroller.addEventListener('scroll', schedule, { passive: true });
    // Folding or unfolding the row moves its own fold button.
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    resize?.observe(row);
    return () => {
      scroller.removeEventListener('scroll', schedule);
      resize?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [rowRef, toolbarRef, shown]);

  return clearance;
};
