import { useCallback, useLayoutEffect, useRef } from 'react';
import { isIOSWebKitDevice } from './scrollQuiescence';

/** Commits a clamped correction waits for the longer list before it is given up. */
const MAX_COMMITS = 3;

type Pending = {
  /** Where the corrections applied since the first clamped one put the reader. */
  target: number;
  /** Where the browser leaves them: at the end of the list it still has. */
  clampedAt: number;
  commits: number;
};

/**
 * Finishes the scroll corrections the browser clamps at the end. virtual-core moves the reader
 * down by a row above them that grew, in its ResizeObserver callback, before React renders the
 * longer list (the offset ledger holds the list's height for the render that moves the rows before
 * the paint). Near the end the browser clamps that write to the end the list still has, so the
 * reader would stay short of the new end by the growth. The commit that renders the longer list
 * moves them the rest of the way, unless something else moved them since. iOS WebKit is left out:
 * virtual-core banks a correction made there while a finger is down and replays it itself.
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
      if (!scrollElement || isIOSWebKitDevice()) return;
      const end = scrollElement.scrollHeight - scrollElement.clientHeight;
      if (!Number.isFinite(end)) return;
      const target = (pendingRef.current?.target ?? scrollElement.scrollTop) + deltaPx;
      if (!pendingRef.current && target <= end + 0.5) return;
      pendingRef.current = {
        target,
        clampedAt: Math.max(0, Math.min(scrollElement.scrollTop + deltaPx, end)),
        commits: 0,
      };
    },
    [getScrollElement]
  );

  useLayoutEffect(() => {
    const pending = pendingRef.current;
    const scrollElement = getScrollElement();
    if (!pending || !scrollElement) return;
    // Moved by something else meanwhile: the reader, a jump, a pin.
    if (Math.abs(scrollElement.scrollTop - pending.clampedAt) > 0.5) {
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
