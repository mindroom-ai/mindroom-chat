import { type MouseEvent, type PointerEvent, useEffect, useRef } from 'react';
import { LONG_PRESS_MS, LONG_PRESS_SLOP } from './useLongPress';

type Press = { timer: ReturnType<typeof setTimeout>; x: number; y: number };

/**
 * Pointer handlers, for a mouse, a finger and a pen alike, that call `onLongPress` with the element
 * they are on once the pointer has rested `LONG_PRESS_MS` on it. Moving more than
 * `LONG_PRESS_SLOP`, lifting, leaving the element or the browser cancelling the pointer ends the
 * press first. Once the press fired, the click that ends it is dropped, so a hold never also does
 * what a tap does, and neither does the context menu a resting finger would open. `canStart`
 * decides per press whether one may begin; when it may not, the element works as before.
 */
export function usePointerLongPress(
  onLongPress: (element: HTMLElement) => void,
  canStart: () => boolean
) {
  const press = useRef<Press>();
  const fired = useRef(false);
  const latest = useRef(onLongPress);
  latest.current = onLongPress;

  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = undefined;
  };

  // An element that unmounts mid-press stops its timer.
  useEffect(
    () => () => {
      if (press.current) clearTimeout(press.current.timer);
    },
    []
  );

  const onPointerDown = (evt: PointerEvent<HTMLElement>) => {
    cancel();
    fired.current = false;
    if (!evt.isPrimary || evt.button !== 0 || !canStart()) return;
    const element = evt.currentTarget;
    const timer = setTimeout(() => {
      press.current = undefined;
      fired.current = true;
      latest.current(element);
    }, LONG_PRESS_MS);
    press.current = { timer, x: evt.clientX, y: evt.clientY };
  };

  const onPointerMove = (evt: PointerEvent<HTMLElement>) => {
    const current = press.current;
    if (current && Math.hypot(evt.clientX - current.x, evt.clientY - current.y) > LONG_PRESS_SLOP) {
      cancel();
    }
  };

  const onClickCapture = (evt: MouseEvent<HTMLElement>) => {
    if (!fired.current) return;
    fired.current = false;
    evt.preventDefault();
    evt.stopPropagation();
  };

  const onContextMenu = (evt: MouseEvent<HTMLElement>) => {
    if (press.current || fired.current) evt.preventDefault();
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClickCapture,
    onContextMenu,
  };
}
