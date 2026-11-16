import { type RefObject, useLayoutEffect, useRef } from 'react';
import { GLIDE_EASING, GLIDE_MS, prefersReducedMotion } from './tourMotion';

/** A row that joins the list comes up a little as it fades in, as what arrives in the room does. */
const ARRIVAL: Keyframe[] = [
  { opacity: 0, transform: 'translateY(6px)' },
  { opacity: 1, transform: 'none' },
];

/**
 * Glides a list's rows to their new places when its order changes: a card that moves to the top,
 * the cards under one that left. A row that joins the rows already there fades in at its place
 * meanwhile: a thread the filters bring back. A row is any element inside the list with
 * `data-flip-key`; `order` is a text that changes when their places may. Each row is measured
 * after every render by its layout offset, which a running move does not change, and then plays
 * from where it was to where it is. Nothing moves with reduced motion or where the browser has
 * no Web Animations.
 */
export const useFlipList = (listRef: RefObject<HTMLElement>, order: string): void => {
  const tops = useRef(new Map<string, number>());
  const shownOrder = useRef(order);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const moved = shownOrder.current !== order && !prefersReducedMotion();
    shownOrder.current = order;
    const before = tops.current;
    const now = new Map<string, number>();
    list.querySelectorAll<HTMLElement>('[data-flip-key]').forEach((row) => {
      const key = row.dataset.flipKey;
      if (key === undefined) return;
      const top = row.offsetTop;
      now.set(key, top);
      if (!moved || typeof row.animate !== 'function') return;
      const timing = { duration: GLIDE_MS, easing: GLIDE_EASING };
      const from = before.get(key);
      if (from === undefined) {
        // The rows a list starts with are there at once.
        if (before.size > 0) row.animate(ARRIVAL, timing);
      } else if (from !== top) {
        row.animate(
          [{ transform: `translateY(${from - top}px)` }, { transform: 'translateY(0)' }],
          timing
        );
      }
    });
    tops.current = now;
  });
};
