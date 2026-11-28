import {
  createContext,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { readTopInset } from '../ui/styles/threadHeaderInset';

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
/** Marks the card of an inline canvas, not its fallback notice. */
export const INLINE_CANVAS_ATTRIBUTE = 'data-inline-canvas';
export const MessageInlineCanvasContext = createContext<Dispatch<SetStateAction<number>> | undefined>(
  undefined
);
/**
 * The Show full message / Show less button of a long message (CollapsibleMessage). It sits at the
 * end of the message's bottom edge, the corner the toolbar of the row below floats over.
 */
const FOLD_BUTTON = '[data-message-fold] > * > [data-message-disclosure] > button';
/**
 * Buttons at the end side of a message's content: a code block's (Wrap lines, Expand, Copy code)
 * and a file card's (View, Download). They sit under a toolbar that moves down into a row.
 */
const CONTENT_ACTIONS = '[data-code-block-actions], [data-file-actions]';
/**
 * The tight wrapper around a message's sender name and timestamp at the start of its header row.
 * When wide enough to reach under the toolbar (narrow viewports or long names), the toolbar keeps
 * clear of it.
 */
const SENDER_LINE = '[data-message-sender-line]';
// Space kept between the toolbar and such controls, so a control does not read as part of it.
const CONTROL_GAP_PX = 8;
// Breathing room below the sticky room header or thread banner while a tall row's toolbar travels.
const TRAVEL_GAP_PX = 6;
// The lowest a toolbar moved into its row goes: this far above the row's bottom.
const ROW_END_GAP_PX = 4;

/**
 * The lowest point of what floats over the top of a scroller where a toolbar spanning `left` to
 * `right` would sit: the scroller's `scroll-padding-top` (room header and sticky thread banner)
 * plus a small breathing gap, and any controls floating right above the rows (`[+all]`).
 */
const coveredUntilY = (scroller: HTMLElement, left: number, right: number): number => {
  let bottom = scroller.getBoundingClientRect().top + readTopInset(scroller) + TRAVEL_GAP_PX;
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

/** A fold button or preceding inline canvas, relative to the top of the toolbar's row. */
type FoldSpan = Span & { ownRow: boolean };

/**
 * Where the toolbar's top goes, relative to the top of its row, or `undefined` for its usual
 * place. `usual` is that place, `covered` where what floats over the top of the timeline ends,
 * `height` the toolbar's own height, `folds` the fold buttons and preceding inline canvases under
 * its span, `senderLine` the row's sender line where it is under the span, and `contentActions`
 * the buttons of the row's code blocks and files under the span.
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
  const overlapsControl = (at: number, control: Span) =>
    at < control.bottom && at + height > control.top;
  const nearControl = (at: number, control: Span) =>
    at < control.bottom + CONTROL_GAP_PX && at + height > control.top - CONTROL_GAP_PX;
  const clearAt = (at: number) =>
    ![...folds, ...contentActions].some((control) => nearControl(at, control));
  // Travel smoothly below the sticky header/banner once scrolled past usual, clamping 4 px above
  // the row's bottom so short rows never jump above usual.
  let top =
    covered > usual + 0.5
      ? Math.max(usual, Math.min(covered, rowHeight - ROW_END_GAP_PX - height))
      : usual;
  [...folds]
    .sort((a, b) => a.top - b.top)
    .forEach((fold) => {
      if (nearControl(top, fold)) {
        // A fold button or canvas of a row above pushes the toolbar down; the row's own fold
        // button, at its bottom, pushes it up.
        top = fold.ownRow ? fold.top - CONTROL_GAP_PX - height : fold.bottom + CONTROL_GAP_PX;
      }
    });
  // Where the toolbar would cover the buttons of a code block or file (either when traveling
  // into a row or when its resting edge overlaps them), move to the nearest clear spot below them
  // inside the row; if still at rest and too short below, step above them when clear.
  const movedDown = top > usual + 0.5;
  const blockingActions = contentActions.filter((actions) =>
    movedDown ? nearControl(top, actions) : overlapsControl(top, actions)
  );
  if (blockingActions.length > 0) {
    const below = contentActions
      .map((actions) => actions.bottom + CONTROL_GAP_PX)
      .filter((at) => at > top)
      .sort((a, b) => a - b)
      .find((at) => at + height <= rowHeight - ROW_END_GAP_PX && clearAt(at));
    if (below !== undefined) {
      top = below;
    } else if (!movedDown) {
      const above =
        Math.min(...blockingActions.map((actions) => actions.top)) - CONTROL_GAP_PX - height;
      if (above >= covered && clearAt(above)) top = above;
    }
  }
  // When the tight sender line reaches horizontally under the toolbar (narrow viewport or long
  // name), move below it when that fits cleanly inside the row; otherwise float above the row edge
  // when at rest with room above and clear, or fall back below it when a fold button or sticky
  // header blocks going above so the name and timestamp stay readable and clickable.
  if (
    senderLine &&
    senderLine.bottom > covered &&
    (top > usual + 0.5 || usual >= 0) &&
    top < senderLine.bottom &&
    top + height > senderLine.top
  ) {
    const below = senderLine.bottom + CONTROL_GAP_PX;
    const above = Math.min(0, senderLine.top) - height;
    if (below + height <= rowHeight - ROW_END_GAP_PX && clearAt(below)) {
      top = below;
    } else if (top <= usual + 0.5 && above >= covered && clearAt(above)) {
      top = above;
    } else if (clearAt(below)) {
      top = below;
    }
  }
  return Math.abs(top - usual) > 0.5 ? Math.round(top) : undefined;
};

/**
 * How far below the top of its row the hover toolbar sits, in pixels, or `undefined` in its usual
 * place. Headered rows dock inside the empty end half of their header row; follow-up rows straddle
 * their top-end edge. When a tall row scrolls under the floating room header or sticky thread
 * banner, or collides with `[+all]`, fold buttons, an inline canvas above, content action buttons,
 * or a wide sender line, the toolbar travels to stay clear. Measured while shown and updated on
 * scroll/resize.
 */
export const useToolbarClearance = (
  rowRef: RefObject<HTMLElement | null>,
  toolbarRef: RefObject<HTMLElement | null>,
  shown: boolean
): number | undefined => {
  const [clearance, setClearance] = useState<number>();
  const clearanceRef = useRef<number>(undefined);
  clearanceRef.current = clearance;
  // The toolbar's usual offset from the top of its row, measured while it sits there.
  const usualOffset = useRef<number>(undefined);

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
      const underBar = (control: Element): Span[] => {
        const rect = control.getBoundingClientRect();
        if (!(rect.width > 0 && rect.left < bar.right && rect.right > bar.left)) return [];
        const top = rect.top - rowRect.top;
        return [{ top, bottom: top + rect.height }];
      };
      const folds = Array.from(scroller.querySelectorAll(FOLD_BUTTON)).flatMap((button) =>
        underBar(button).map((span) => ({ ...span, ownRow: row.contains(button) }))
      );
      const canvases = Array.from(scroller.querySelectorAll(`[${INLINE_CANVAS_ATTRIBUTE}]`))
        .filter(
          (card) =>
            !row.contains(card) &&
            Boolean(card.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)
        )
        .flatMap((card) => underBar(card).map((span) => ({ ...span, ownRow: false })));
      const contentActions = Array.from(row.querySelectorAll(CONTENT_ACTIONS)).flatMap(underBar);
      const sender = row.querySelector(SENDER_LINE);
      const [senderLine] = sender ? underBar(sender) : [];
      const next = toolbarOffset(
        usualOffset.current ?? 0,
        coveredUntilY(scroller, bar.left, bar.right) - rowRect.top,
        rowRect.height,
        bar.height,
        [...folds, ...canvases],
        senderLine,
        contentActions
      );
      if (next !== clearanceRef.current) setClearance(next);
    };
    place();
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    scroller.addEventListener('scroll', schedule, { passive: true });
    // Folding or unfolding the row moves its own fold button. A reply's timing or run details
    // arriving with a later edit widen its sender line, which on narrow screens can reach the bar.
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
