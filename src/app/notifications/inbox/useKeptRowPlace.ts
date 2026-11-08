import { useCallback, useEffect, useMemo, useRef, type PointerEvent, type RefObject } from 'react';

/** The attribute that names a row's notification (its event ID). */
const KEPT_ROW_ATTRIBUTE = 'data-notification-event';

type Point = { x: number; y: number };

const rowAt = (point: Point | undefined): HTMLElement | undefined =>
  (point &&
    document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>(`[${KEPT_ROW_ATTRIBUTE}]`)) ??
  undefined;

const firstRowInView = (view: HTMLElement): HTMLElement | undefined => {
  const viewTop = view.getBoundingClientRect().top;
  return [...view.querySelectorAll<HTMLElement>(`[${KEPT_ROW_ATTRIBUTE}]`)].find(
    (row) => row.getBoundingClientRect().bottom > viewTop
  );
};

/** For how many frames after a change the row is held, while rows that joined settle. */
const HOLD_FRAMES = 4;

/**
 * Keeps the reader's place in the scrolling list `viewRef` while its rows change under them:
 * `keepPlace(apply)` runs `apply`, which must update the rows at once (`flushSync`), and scrolls
 * the list by as much as one row moved. That row is the one under the pointer (a resting mouse,
 * or a finger from its press to the click of its tap), so it is still there to be clicked, else,
 * for a reader scrolled down, the topmost row in view. A reader at the top with no pointer on a row
 * sees new rows arrive at the top. Chromium's scroll anchoring keeps the rows in view in place by
 * itself, and the row is then found where it was; WebKit has none. The row is held for the next
 * few frames, as rows that joined settle their height: a row with `content-visibility: auto` is
 * laid out at its placeholder height until a frame finds out whether it is in view, so a resize
 * observer, which runs before that frame is painted, puts the row back, whatever the browser's
 * own anchoring did. The handlers go on the list.
 */
export const useKeptRowPlace = (viewRef: RefObject<HTMLElement>) => {
  const pointer = useRef<Point>();
  const hold = useRef<() => void>();
  useEffect(() => () => hold.current?.(), []);

  const keepPlace = useCallback(
    (apply: () => void) => {
      hold.current?.();
      const view = viewRef.current;
      const row = rowAt(pointer.current) ?? (view?.scrollTop ? firstRowInView(view) : undefined);
      const id = row?.getAttribute(KEPT_ROW_ATTRIBUTE);
      const top = row?.getBoundingClientRect().top;
      apply();
      if (!view || !id || top === undefined) return;
      const putBack = () => {
        const now = view
          .querySelector(`[${KEPT_ROW_ATTRIBUTE}="${CSS.escape(id)}"]`)
          ?.getBoundingClientRect().top;
        if (now !== undefined && Math.abs(now - top) >= 0.5) view.scrollTop += now - top;
      };
      putBack();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(putBack);
      let frames = HOLD_FRAMES;
      let frame = 0;
      const release = () => {
        observer.disconnect();
        cancelAnimationFrame(frame);
        hold.current = undefined;
      };
      const countDown = () => {
        frames -= 1;
        if (frames > 0) frame = requestAnimationFrame(countDown);
        else release();
      };
      frame = requestAnimationFrame(countDown);
      Array.from(view.children).forEach((child) => observer.observe(child));
      hold.current = release;
    },
    [viewRef]
  );

  const handlers = useMemo(() => {
    const follow = (event: PointerEvent<HTMLElement>) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    const release = () => {
      pointer.current = undefined;
    };
    return {
      onPointerMove: follow,
      onPointerDown: follow,
      // A scroll by touch cancels the finger's pointer.
      onPointerCancel: release,
      onPointerLeave: (event: PointerEvent<HTMLElement>) => {
        if (event.pointerType !== 'touch') release();
        // A finger leaves as it lifts, before its tap's click: the row stays until that click.
        else document.addEventListener('click', release, { capture: true, once: true });
      },
    };
  }, []);

  return { keepPlace, handlers };
};
