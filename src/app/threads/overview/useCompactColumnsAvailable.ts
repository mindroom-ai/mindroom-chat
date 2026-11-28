import { type RefObject, useLayoutEffect, useState } from 'react';
import { COMPACT_COLUMNS_MIN_WIDTH_PX } from './compactColumnsLayout';

/**
 * Observes `containerRef` with `ResizeObserver` and returns whether the pane is wide enough for
 * side-by-side workflow columns (`COMPACT_COLUMNS_MIN_WIDTH_PX`). Defaults to `false` before
 * measurement or when `ResizeObserver` is unavailable so SSR and narrow/unmeasured layouts stay
 * on vertical sections until measured wide.
 */
export const useCompactColumnsAvailable = (
  containerRef: RefObject<HTMLElement | null>
): boolean => {
  const [available, setAvailable] = useState(false);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      setAvailable(false);
      return undefined;
    }
    const measure = (width?: number) => {
      const measured = width && width > 0 ? width : element.clientWidth;
      if (measured > 0) setAvailable(measured >= COMPACT_COLUMNS_MIN_WIDTH_PX);
    };
    measure();
    const observer = new ResizeObserver((entries) => measure(entries[0]?.contentRect?.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef]);

  return available;
};
