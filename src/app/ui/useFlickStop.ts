import { useCallback, useEffect, useRef } from 'react';
import { isIOS } from '../lib/user-agent';

/**
 * Stops an iOS flick before a floating pill jumps. The compositor can discard scroll writes during
 * momentum. Hide overflow for the write and restore it two frames later so one frame renders hidden.
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
