import { useCallback, useLayoutEffect, useRef } from 'react';

/** Commits a clamped correction waits for the longer list before it is given up. */
const MAX_COMMITS = 3;

type Pending = {
  /** Where the corrections applied since the last finished one put the reader. */
  target: number;
  /** Where the browser left them, read at the first commit after the correction. */
  clampedAt?: number;
  commits: number;
};

/**
 * Finishes the scroll corrections the browser clamped at the end. virtual-core moves the reader
 * down by a row above them that grew, in its ResizeObserver callback, before React renders the
 * longer list (the offset ledger holds the list's height for the render that moves the rows before
 * the paint). Near the end the browser clamps that write to the end the list still has, so the
 * reader would stay short of the new end by the growth. The commit that renders the longer list
 * moves them the rest of the way, unless something else moved them since.
 *
 * Returns the callback for each correction virtual-core applies, called before it writes it.
 */
export const useClampedCorrectionFinish = (
  getScrollElement: () => HTMLElement | null
): ((deltaPx: number) => void) => {
  const pendingRef = useRef<Pending>();

  const noteAppliedCorrection = useCallback(
    (deltaPx: number) => {
      const scrollElement = getScrollElement();
      const pending = pendingRef.current;
      // Only a correction that moves the reader down can meet the end.
      if (!scrollElement || (!pending && deltaPx <= 0)) return;
      pendingRef.current = {
        target: (pending?.target ?? scrollElement.scrollTop) + deltaPx,
        commits: 0,
      };
    },
    [getScrollElement]
  );

  useLayoutEffect(() => {
    const pending = pendingRef.current;
    const scrollElement = getScrollElement();
    if (!pending || !scrollElement) return;
    const { scrollTop } = scrollElement;
    if (pending.clampedAt === undefined) pending.clampedAt = scrollTop;
    // Already there, or moved by something else meanwhile (the reader, a jump).
    if (scrollTop >= pending.target - 0.5 || Math.abs(scrollTop - pending.clampedAt) > 0.5) {
      pendingRef.current = undefined;
      return;
    }
    if (scrollElement.scrollHeight - scrollElement.clientHeight >= pending.target - 0.5) {
      pendingRef.current = undefined;
      scrollElement.scrollTop = pending.target;
      return;
    }
    pending.commits += 1;
    if (pending.commits >= MAX_COMMITS) pendingRef.current = undefined;
  });

  return noteAppliedCorrection;
};
