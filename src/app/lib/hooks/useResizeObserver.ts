import { useEffect, useRef } from 'react';

/**
 * Observes the element(s) `getElement` returns and calls `onResize` with each batch of entries.
 * The observer follows `getElement` when its identity changes.
 */
export const useResizeObserver = (
  onResize: (entries: ResizeObserverEntry[]) => void,
  getElement: () => Element | Element[] | null | undefined
): void => {
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const target = getElement();
    const elements = (Array.isArray(target) ? target : [target]).filter(
      (element): element is Element => !!element
    );
    if (elements.length === 0) return undefined;
    const observer = new ResizeObserver((entries) => onResizeRef.current(entries));
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [getElement]);
};
