import { useCallback, useEffect, useRef } from 'react';
import { isIOS } from '../lib/user-agent';

/**
 * Asks iOS to stop a touch flick before the reader's own Jump to Latest writes: the button is
 * outside the scroll area, so its tap does not end the flick, and a write inside a scroll the
 * compositor still owns can be discarded (see the offset ledger's discard watch). The area takes
 * `overflow-y: hidden` for the write and gets its own value back two frames later, so one frame
 * renders it hidden. iOS only; the timeline's own pins never call it.
 */
export const useFlickStop = (getScrollElement: () => HTMLElement | null): (() => void) => {
  const stoppedRef = useRef<{ element: HTMLElement; overflowY: string; frame: number }>();
  const restore = useCallback(() => {
    const stopped = stoppedRef.current;
    if (!stopped) return;
    stoppedRef.current = undefined;
    cancelAnimationFrame(stopped.frame);
    stopped.element.style.overflowY = stopped.overflowY;
  }, []);
  // Leaving the view gives the area its overflow back at once.
  useEffect(() => restore, [restore]);
  return useCallback(() => {
    const element = getScrollElement();
    if (!element || !isIOS()) return;
    // A second jump starts over from the area's own value.
    restore();
    const stopped = { element, overflowY: element.style.overflowY, frame: 0 };
    stoppedRef.current = stopped;
    element.style.overflowY = 'hidden';
    stopped.frame = requestAnimationFrame(() => {
      stopped.frame = requestAnimationFrame(restore);
    });
  }, [getScrollElement, restore]);
};
