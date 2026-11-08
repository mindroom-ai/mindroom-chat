import { useEffect } from 'react';
import { atom, useSetAtom } from 'jotai';
import { useEdgeSwipe } from './useEdgeSwipe';

/**
 * How many back swipes (a room's, a thread's) are on: while one is, a swipe from the screen's
 * left edge goes back, and a phone's drawer leaves that swipe to it.
 */
export const edgeSwipeBackCountAtom = atom(0);

export const useEdgeSwipeBack = (
  onBack: () => void,
  enabled: boolean = true,
  options: { blockStandaloneWebApp?: boolean } = {}
): void => {
  useEdgeSwipe({
    direction: 'back',
    enabled,
    onSwipe: onBack,
    blockStandaloneWebApp: options.blockStandaloneWebApp,
  });

  const setCount = useSetAtom(edgeSwipeBackCountAtom);
  useEffect(() => {
    if (!enabled) return undefined;
    setCount((count) => count + 1);
    return () => setCount((count) => count - 1);
  }, [enabled, setCount]);
};
