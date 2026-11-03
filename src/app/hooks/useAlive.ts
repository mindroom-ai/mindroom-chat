import { useCallback, useEffect, useRef } from 'react';

/**
 * A stable function that tells whether the component is still mounted, so async work can drop
 * results that arrive after unmount. True from the first render, so work started during render
 * or in a layout effect counts as alive.
 */
export const useAlive = (): (() => boolean) => {
  // Flipped by the effect cleanup; a StrictMode remount runs the effect again and resets it.
  const detached = useRef(false);

  useEffect(() => {
    detached.current = false;
    return () => {
      detached.current = true;
    };
  }, []);

  return useCallback(() => !detached.current, []);
};
