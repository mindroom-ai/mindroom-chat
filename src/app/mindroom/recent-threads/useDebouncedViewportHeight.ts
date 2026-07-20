import { useEffect, useState } from 'react';

const VIEWPORT_RESIZE_DEBOUNCE_MS = 100;

const getViewportHeight = (): number => (typeof window === 'undefined' ? 0 : window.innerHeight);

export const useDebouncedViewportHeight = (debounceMs = VIEWPORT_RESIZE_DEBOUNCE_MS): number => {
  const [viewportHeight, setViewportHeight] = useState(getViewportHeight);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let timeoutId: number | undefined;

    const handleResize = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        setViewportHeight(getViewportHeight());
        timeoutId = undefined;
      }, debounceMs);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
    };
  }, [debounceMs]);

  return viewportHeight;
};
