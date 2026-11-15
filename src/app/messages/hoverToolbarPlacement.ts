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
 * Buttons at the end side of a message's content: a code block's (Wrap lines, Expand, Copy code),
 * at the end of its top edge, and a file card's (View, Download). They sit under a toolbar that
 * moves down into a row whose code block or file starts at its top or below its sender line; where
 * it cannot keep clear of them above or below, it moves toward the row's start edge, beside them.
 */
const CONTENT_ACTIONS = '[data-code-block-actions], [data-file-actions]';
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

/** A control's top and bottom, relative to the top of the toolbar's row. */
type Span = { top: number; bottom: number };

/** A fold button beside the toolbar, relative to the top of the toolbar's row. */
type FoldSpan = Span & { ownRow: boolean };

/**
 * Content buttons under the toolbar, relative to the top of its row, and how far their start
 * edge reaches from the toolbar's end edge toward its start edge.
 */
type ActionsSpan = Span & { reach: number };

/** Whether a toolbar `height` tall with its top at `at` comes within 8 px of `control`. */
const nearControl = (at: number, height: number, control: Span) =>
  at < control.bottom + CONTROL_GAP_PX && at + height > control.top - CONTROL_GAP_PX;

/** Where the toolbar sits when it is not in its usual place above the row. */
export type ToolbarPlacement = {
  /** Its top, relative to the top of its row. */
  top: number;
  /** How far it moves from the row's end edge toward its start edge, beside content buttons. */
  shift?: number;
};

/**
 * Where the toolbar's top goes, relative to the top of its row, or `undefined` for its usual
 * place. `usual` is that place, `covered` where what floats over the top of the timeline ends,
 * `height` the toolbar's own height, `folds` the fold buttons under its span, `senderLine`
 * the row's sender line where it is under the span, and `contentActions` the buttons of the row's
 * code blocks and files under the span.
 */
export const toolbarOffset = (
  usual: number,
  covered: number,
  rowHeight: number,
  height: number,
  folds: FoldSpan[],
  senderLine?: Span,
  contentActions: Span[] = []
): number | undefined => {
  const clearAt = (at: number) =>
    ![...folds, ...contentActions].some((control) => nearControl(at, height, control));
  // Below the header and the controls under it, but no lower than 4 px above the row's bottom.
  let top = covered > usual + 0.5 ? Math.min(covered, rowHeight - ROW_END_GAP_PX - height) : usual;
  [...folds]
    .sort((a, b) => a.top - b.top)
    .forEach((fold) => {
      if (nearControl(top, height, fold)) {
        // The fold button of the long message above pushes the toolbar down into its row; the
        // row's own, at its bottom, pushes it up.
        top = fold.ownRow ? fold.top - CONTROL_GAP_PX - height : fold.bottom + CONTROL_GAP_PX;
      }
    });
  // Moved down into its row, where it would cover the buttons of a code block or a file, it goes
  // on to the nearest spot below such buttons that ends inside the row clear of every button
  // group and fold button, and stays where none is; up, it would go back under what floats over
  // the timeline.
  if (top > usual + 0.5 && contentActions.some((actions) => nearControl(top, height, actions))) {
    const below = contentActions
      .map((actions) => actions.bottom + CONTROL_GAP_PX)
      .filter((at) => at > top)
      .sort((a, b) => a - b)
      .find((at) => at + height <= rowHeight - ROW_END_GAP_PX && clearAt(at));
    if (below !== undefined) top = below;
  }
  // Moved down into its row, it goes on below the row's sender line where that shows, so the
  // name, the time and the reply details button stay in reach, unless a fold button is there (a
  // long row's own Show less sticks to the bottom of the view) or the buttons of a code block or
  // a file are: then it stays over the sender line, unless it went below those buttons above. In
  // its usual place it ends a few pixels into the row, above the line's text.
  if (
    senderLine &&
    senderLine.bottom > covered &&
    top > usual + 0.5 &&
    top < senderLine.bottom &&
    top + height > senderLine.top
  ) {
    const below = senderLine.bottom + CONTROL_GAP_PX;
    if (clearAt(below)) top = below;
  }
  return Math.abs(top - usual) > 0.5 ? Math.round(top) : undefined;
};

/**
 * How far a toolbar out of its usual place, with its top at `top` and `height` tall, moves from
 * the row's end edge toward its start edge so it ends 8 px before the content buttons it still
 * covers (`contentActions`), or `undefined` where it covers none or has less than that much `room`
 * beside its start edge: there it stays.
 */
export const toolbarShift = (
  top: number,
  height: number,
  contentActions: ActionsSpan[],
  room: number
): number | undefined => {
  const reaches = contentActions
    .filter((actions) => nearControl(top, height, actions))
    .map((actions) => actions.reach);
  if (reaches.length === 0) return undefined;
  const shift = Math.ceil(Math.max(...reaches) + CONTROL_GAP_PX);
  return shift <= room ? shift : undefined;
};

/**
 * How far below the top of its row the hover toolbar sits, in pixels, or `undefined` in its usual
 * place above the row. It moves to stay clear of what floats over the top of the timeline (the
 * first row starts right under the room's `[+all]` toggle or a thread's banner, so its toolbar
 * moves down into the row instead of covering them) and of the fold buttons of long messages, so
 * it never draws over a Show less button. Moved down into its row, it also keeps clear of the
 * buttons of a code block or a file where the row has room below them, and below the row's sender
 * line unless such buttons are there; where it still covers such buttons, it moves beside them.
 * Measured while the toolbar shows, and again as the timeline scrolls under it or the row changes
 * size.
 */
export const useToolbarClearance = (
  rowRef: RefObject<HTMLElement>,
  toolbarRef: RefObject<HTMLElement>,
  shown: boolean
): ToolbarPlacement | undefined => {
  const [clearance, setClearance] = useState<ToolbarPlacement>();
  const clearanceRef = useRef<ToolbarPlacement>();
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
    const rtl = getComputedStyle(row).direction === 'rtl';
    let frame = 0;
    const place = () => {
      frame = 0;
      const toolbar = toolbarRef.current;
      if (!toolbar) return;
      const rowRect = row.getBoundingClientRect();
      const bar = toolbar.getBoundingClientRect();
      if (clearanceRef.current === undefined) usualOffset.current = bar.top - rowRect.top;
      // The toolbar's span at the row's end edge, before any shift, so a toolbar that moved
      // beside the buttons keeps them in view and stays there.
      const back = (clearanceRef.current?.shift ?? 0) * (rtl ? -1 : 1);
      const left = bar.left + back;
      const right = bar.right + back;
      const span = (rect: DOMRect): Span => ({
        top: rect.top - rowRect.top,
        bottom: rect.bottom - rowRect.top,
      });
      const underBar = (control: Element): ActionsSpan[] => {
        const rect = control.getBoundingClientRect();
        if (!(rect.width > 0 && rect.left < right && rect.right > left)) return [];
        return [{ ...span(rect), reach: rtl ? rect.right - left : right - rect.left }];
      };
      const folds = Array.from(scroller.querySelectorAll(FOLD_BUTTON)).flatMap((button) =>
        underBar(button).map((span) => ({ ...span, ownRow: row.contains(button) }))
      );
      const contentActions = Array.from(row.querySelectorAll(CONTENT_ACTIONS)).flatMap(underBar);
      const sender = row.querySelector(SENDER_LINE);
      const [senderLine] = sender ? underBar(sender) : [];
      const covered = coveredUntilY(scroller, left, right) - rowRect.top;
      const top = toolbarOffset(
        usualOffset.current ?? 0,
        covered,
        rowRect.height,
        bar.height,
        folds,
        senderLine,
        contentActions
      );
      // It moves beside buttons it still covers as far as the row's start edge, or 8 px short of
      // the name or the time of a visible sender line where they start before its span: in
      // Compact, they start the line of the code block or the file.
      const stops = Array.from(sender?.children ?? [])
        .map((part) => part.getBoundingClientRect())
        .filter(
          (rect) => (rtl ? rect.right > right : rect.left < left) && span(rect).bottom > covered
        )
        .map((rect) => (rtl ? rect.left - CONTROL_GAP_PX : rect.right + CONTROL_GAP_PX));
      const room = rtl
        ? Math.min(rowRect.right, ...stops) - right
        : left - Math.max(rowRect.left, ...stops);
      const next =
        top === undefined
          ? undefined
          : { top, shift: toolbarShift(top, bar.height, contentActions, room) };
      if (next?.top !== clearanceRef.current?.top || next?.shift !== clearanceRef.current?.shift) {
        setClearance(next);
      }
    };
    place();
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    scroller.addEventListener('scroll', schedule, { passive: true });
    // Folding or unfolding the row moves its own fold button. A reply's run details arriving with
    // a later edit widen its sender line, which in Compact can then reach under the toolbar.
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    resize?.observe(row);
    const senderLine = row.querySelector(SENDER_LINE);
    if (senderLine) resize?.observe(senderLine);
    return () => {
      scroller.removeEventListener('scroll', schedule);
      resize?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [rowRef, toolbarRef, shown]);

  return clearance;
};
