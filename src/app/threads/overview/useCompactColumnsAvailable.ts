import { type RefObject, useLayoutEffect, useState } from 'react';
import { COMPACT_COLUMNS_MIN_WIDTH_PX } from './compactColumnsLayout';

const BASE_ROOT_FONT_SIZE_PX = 16;

const rootFontSizePx = (): number => {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return BASE_ROOT_FONT_SIZE_PX;
  }
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || BASE_ROOT_FONT_SIZE_PX;
};

/**
 * Observes `containerRef` with `ResizeObserver` and returns whether the pane is wide enough for
 * side-by-side workflow columns (`COMPACT_COLUMNS_MIN_WIDTH_PX` scaled by root `rem` font size for
 * Page Zoom). Defaults to `false` before measurement or when `ResizeObserver` is unavailable so
 * SSR and narrow/unmeasured layouts stay on vertical sections until measured wide.
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
      if (measured > 0) {
        const minWidthPx =
          (COMPACT_COLUMNS_MIN_WIDTH_PX / BASE_ROOT_FONT_SIZE_PX) * rootFontSizePx();
        setAvailable(measured >= minWidthPx);
      }
    };
    measure();
    const observer = new ResizeObserver((entries) => measure(entries?.[0]?.contentRect?.width));
    observer.observe(element);
    const zoomObserver =
      typeof MutationObserver === 'undefined' || typeof document === 'undefined'
        ? undefined
        : new MutationObserver(() => measure());
    zoomObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    const onResize = () => measure();
    if (typeof window !== 'undefined') window.addEventListener('resize', onResize);
    return () => {
      observer.disconnect();
      zoomObserver?.disconnect();
      if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
    };
  }, [containerRef]);

  return available;
};
