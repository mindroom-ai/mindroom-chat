import { type RefObject, useLayoutEffect, useRef } from 'react';
import { playsMotion } from '../../ui/listMotion';
import { springOf, springSettled, stepSpring, type SpringState } from '../../ui/styles/spring';

// A soft glide with a hint of settle: damping ratio 0.78, settled in about 460 ms.
const PILL_SPRING = springOf(0.78, 460);
// A frame after a stall moves the pill at most this far along its curve.
const MAX_FRAME_SECONDS = 1 / 30;

const atRest = (value: number): SpringState => ({ value, velocity: 0 });

/**
 * Keeps `pill` over the group's pressed button. Every frame reads that button's box again, so the
 * pill follows whatever moves it: a new selection, a label or icon that unfolds, a count that
 * grows, the narrow layout, a late font. It glides there on a spring and stops drawing once
 * settled; a resize anywhere in the group starts it again. It snaps without motion when it first
 * appears (on mount, or after no button was pressed) and when motion is reduced.
 */
export function useSlidingPill(
  groupRef: RefObject<HTMLElement | null>,
  pillRef: RefObject<HTMLElement | null>,
  selected: string | undefined
): void {
  const kickRef = useRef<() => void>();

  useLayoutEffect(() => {
    const group = groupRef.current;
    const pill = pillRef.current;
    if (!group || !pill) return undefined;
    let x: SpringState | undefined;
    let width = atRest(0);
    let frame = 0;
    let lastTime = 0;

    const place = (now?: number) => {
      frame = 0;
      const button = group.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!button || button.offsetWidth === 0) {
        x = undefined;
        lastTime = 0;
        pill.style.opacity = '0';
        return;
      }
      const left = button.offsetLeft;
      const size = button.offsetWidth;
      let moving = false;
      if (x === undefined || now === undefined || !playsMotion(pill)) {
        x = atRest(left);
        width = atRest(size);
      } else {
        const seconds = lastTime ? Math.min((now - lastTime) / 1000, MAX_FRAME_SECONDS) : 1 / 60;
        x = stepSpring(x, left, seconds, PILL_SPRING);
        width = stepSpring(width, size, seconds, PILL_SPRING);
        moving = !springSettled(x, left) || !springSettled(width, size);
        if (!moving) {
          x = atRest(left);
          width = atRest(size);
        }
      }
      pill.style.opacity = '';
      pill.style.transform = `translateX(${x.value}px)`;
      pill.style.width = `${width.value}px`;
      lastTime = moving && now !== undefined ? now : 0;
      if (moving) frame = requestAnimationFrame(place);
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    kickRef.current = kick;

    place();
    // A resize is seen after layout and before paint: without motion the pill lands there at once.
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => (playsMotion(pill) ? kick() : place()));
    observer?.observe(group);
    for (const child of Array.from(group.children)) {
      if (child !== pill) observer?.observe(child);
    }
    return () => {
      kickRef.current = undefined;
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [groupRef, pillRef]);

  useLayoutEffect(() => {
    kickRef.current?.();
  }, [selected]);
}
