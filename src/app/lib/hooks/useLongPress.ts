import { TouchEvent, useEffect, useRef } from 'react';

/** How long a finger rests before the press counts as long, as touch platforms time it. */
export const LONG_PRESS_MS = 500;
/** How far a resting finger may drift, in CSS pixels, before the press becomes a scroll or drag. */
export const LONG_PRESS_SLOP = 10;

type Press = {
  timer: ReturnType<typeof setTimeout>;
  x: number;
  y: number;
  fired: boolean;
  stopWatchingScroll: () => void;
};

/**
 * Touch handlers that call `onLongPress` with the finger's viewport point and the element they are
 * on once one finger has rested `LONG_PRESS_MS` on it. Moving more than `LONG_PRESS_SLOP`, a second finger,
 * any scroll on the page, lifting the finger or the browser cancelling the touch ends the press
 * first. iOS Safari fires no `contextmenu` on a long press, so this is how a finger opens a menu
 * there. Nothing prevents the browser's own handling while the finger rests, so scrolling and text
 * selection work as before; once the press fired, the lift does not also click. `canStart`
 * decides per touch whether a press may begin.
 */
export function useLongPress(
  onLongPress: (x: number, y: number, element: HTMLElement) => void,
  canStart: (evt: TouchEvent<HTMLElement>) => boolean
) {
  const press = useRef<Press>();
  const latest = useRef(onLongPress);
  latest.current = onLongPress;

  const cancel = () => {
    const current = press.current;
    if (!current) return;
    clearTimeout(current.timer);
    current.stopWatchingScroll();
    press.current = undefined;
  };

  // An element that unmounts mid-press stops its timer.
  useEffect(
    () => () => {
      if (press.current) clearTimeout(press.current.timer);
      press.current?.stopWatchingScroll();
    },
    []
  );

  const onTouchStart = (evt: TouchEvent<HTMLElement>) => {
    cancel();
    const touch = evt.touches[0];
    if (evt.touches.length !== 1 || !touch || !canStart(evt)) return;
    const { clientX: x, clientY: y } = touch;
    const element = evt.currentTarget;
    // Any scroll during the press, the timeline's included, means the finger is scrolling.
    const onScroll = () => cancel();
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    const timer = setTimeout(() => {
      const current = press.current;
      if (!current) return;
      current.fired = true;
      current.stopWatchingScroll();
      latest.current(x, y, element);
    }, LONG_PRESS_MS);
    press.current = {
      timer,
      x,
      y,
      fired: false,
      stopWatchingScroll: () => window.removeEventListener('scroll', onScroll, { capture: true }),
    };
  };

  const onTouchMove = (evt: TouchEvent<HTMLElement>) => {
    const current = press.current;
    if (!current || current.fired) return;
    const touch = evt.touches[0];
    if (
      evt.touches.length !== 1 ||
      !touch ||
      Math.hypot(touch.clientX - current.x, touch.clientY - current.y) > LONG_PRESS_SLOP
    ) {
      cancel();
    }
  };

  const onTouchEnd = (evt: TouchEvent<HTMLElement>) => {
    // The menu is open under the finger: lifting it must not click what lies there.
    if (press.current?.fired && evt.cancelable) evt.preventDefault();
    cancel();
  };

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: cancel };
}
