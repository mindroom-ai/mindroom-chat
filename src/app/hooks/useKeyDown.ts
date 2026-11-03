import { useEffect } from 'react';

/** Listens for `keydown` on a window, document or element while mounted. */
export const useKeyDown = (
  target: Window | Document | HTMLElement | null | undefined,
  callback: (event: KeyboardEvent) => void
): void => {
  useEffect(() => {
    if (!target) return undefined;
    const listener = (event: Event) => callback(event as KeyboardEvent);
    target.addEventListener('keydown', listener);
    return () => target.removeEventListener('keydown', listener);
  }, [target, callback]);
};
