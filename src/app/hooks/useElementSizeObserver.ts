import { useEffect, useRef } from 'react';

/** Calls `onResize` with the element's border-box width and height whenever it changes size. */
export const useElementSizeObserver = <T extends Element>(
  getElement: () => T | null | undefined,
  onResize: (width: number, height: number, element: T) => void
): void => {
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  useEffect(() => {
    const element = getElement();
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const report = () => {
      const rect = element.getBoundingClientRect();
      onResizeRef.current(rect.width, rect.height, element);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [getElement]);
};
