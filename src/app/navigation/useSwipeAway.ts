import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';

/** How far a finger moves a panel toward its edge to put it away. */
const SWIPE_AWAY_DISTANCE = 56;

type Point = { x: number; y: number };

const pointOf = (event: TouchEvent): Point | undefined => {
  const touch = event.touches[0];
  return event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : undefined;
};

/**
 * Puts a panel that slid in from an edge (the line's `start` or `end`, so mirrored right to left)
 * away when a finger swipes it back toward that edge, at least 56 px and more sideways than up or
 * down. It listens on the panel's own element in the capture phase: rows inside that take touches
 * for their own gestures do not hide the swipe, and content portaled into the panel counts too.
 */
export const useSwipeAway = (
  ref: RefObject<HTMLElement>,
  edge: 'start' | 'end',
  onSwipe: () => void
): void => {
  const onSwipeRef = useRef(onSwipe);
  useLayoutEffect(() => {
    onSwipeRef.current = onSwipe;
  });

  useEffect(() => {
    const panel = ref.current;
    if (!panel) return undefined;
    let start: Point | undefined;
    let last: Point | undefined;
    const startSwipe = (event: TouchEvent) => {
      start = pointOf(event);
      last = start;
    };
    const moveSwipe = (event: TouchEvent) => {
      last = pointOf(event);
    };
    // Decided from the last move, so a lift the browser reports as a cancel counts too.
    const endSwipe = () => {
      const from = start;
      const to = last;
      start = undefined;
      last = undefined;
      if (!from || !to) return;
      const startward = (from.x - to.x) * (getComputedStyle(panel).direction === 'rtl' ? -1 : 1);
      const towardEdge = edge === 'start' ? startward : -startward;
      if (towardEdge >= SWIPE_AWAY_DISTANCE && towardEdge > Math.abs(to.y - from.y)) {
        onSwipeRef.current();
      }
    };
    const early = { capture: true, passive: true };
    panel.addEventListener('touchstart', startSwipe, early);
    panel.addEventListener('touchmove', moveSwipe, early);
    panel.addEventListener('touchend', endSwipe, early);
    panel.addEventListener('touchcancel', endSwipe, early);
    return () => {
      panel.removeEventListener('touchstart', startSwipe, true);
      panel.removeEventListener('touchmove', moveSwipe, true);
      panel.removeEventListener('touchend', endSwipe, true);
      panel.removeEventListener('touchcancel', endSwipe, true);
    };
  }, [ref, edge]);
};
