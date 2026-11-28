import { type MouseEvent, type PointerEvent, useEffect, useRef } from 'react';
import { holdSelection, LONG_PRESS_MS, LONG_PRESS_SLOP, SELECTION_HOLD_MS } from './useLongPress';

type Press = {
  timer: ReturnType<typeof setTimeout>;
  x: number;
  y: number;
  releaseSelection: () => void;
};

// What the browser still sends for a press that fired, after the pointer events: the mouse events a
// finger's lift makes and the click that ends the press. Every new press starts with a pointerdown.
const ENDING_EVENTS = ['mousedown', 'mouseup', 'click'] as const;

/**
 * Pointer handlers, for a mouse, a finger and a pen alike, that call `onLongPress` with the element
 * they are on once the pointer has rested `LONG_PRESS_MS` on it. Moving more than
 * `LONG_PRESS_SLOP`, lifting, leaving the element or the browser cancelling the pointer ends the
 * press first. After `SELECTION_HOLD_MS`, text is unselectable until the press ends, even if the
 * menu covers the element. A fired press clears selected text but keeps a caret. The mouse events
 * and click from its lift are dropped page-wide, so it neither taps nor closes the menu. The next
 * press, or a key after lift, ends any remaining suppression. `canStart` decides per press whether
 * one may begin; when it may not, the element works as before. No context menu opens under a
 * resting finger.
 */
export function usePointerLongPress(
  onLongPress: (element: HTMLElement) => void,
  canStart: () => boolean
) {
  const press = useRef<Press>(undefined);
  // Set while the end of a press that fired is dropped; stops dropping it.
  const ending = useRef<() => void>(undefined);
  const latest = useRef(onLongPress);
  latest.current = onLongPress;

  const cancel = () => {
    const current = press.current;
    if (!current) return;
    clearTimeout(current.timer);
    current.releaseSelection();
    press.current = undefined;
  };

  // Unmounting ends any pending or fired press, including its selection hold.
  useEffect(
    () => () => {
      cancel();
      ending.current?.();
    },
    []
  );

  // Window capture runs before any other listener, a focus trap's on the document among them. A key
  // ends the dropping only once the pointer is up: a key in the menu (Enter on a row) makes a click
  // that must reach it, but the lift of a pointer still down after Escape must not send.
  const dropEnding = (pointerId: number, releaseSelection: () => void) => {
    let released = false;
    const drop = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.type === 'click') stop();
    };
    const release = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      released = true;
      releaseSelection();
    };
    const onKey = () => {
      if (released) stop();
    };
    const stop = () => {
      ENDING_EVENTS.forEach((type) => window.removeEventListener(type, drop, true));
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      window.removeEventListener('pointerdown', stop, true);
      window.removeEventListener('keydown', onKey, true);
      releaseSelection();
      ending.current = undefined;
    };
    ENDING_EVENTS.forEach((type) => window.addEventListener(type, drop, true));
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('pointerdown', stop, true);
    window.addEventListener('keydown', onKey, true);
    ending.current = stop;
  };

  const onPointerDown = (evt: PointerEvent<HTMLElement>) => {
    cancel();
    if (!evt.isPrimary || evt.button !== 0 || !canStart()) return;
    const element = evt.currentTarget;
    const { pointerId } = evt;
    let releaseHeldSelection: (() => void) | undefined;
    const holdTimer = setTimeout(() => {
      releaseHeldSelection = holdSelection();
    }, SELECTION_HOLD_MS);
    const timer = setTimeout(() => {
      clearTimeout(holdTimer);
      const releaseSelection = releaseHeldSelection ?? holdSelection();
      press.current = undefined;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) selection.removeAllRanges();
      dropEnding(pointerId, releaseSelection);
      latest.current(element);
    }, LONG_PRESS_MS);
    press.current = {
      timer,
      x: evt.clientX,
      y: evt.clientY,
      releaseSelection: () => {
        clearTimeout(holdTimer);
        releaseHeldSelection?.();
      },
    };
  };

  const onPointerMove = (evt: PointerEvent<HTMLElement>) => {
    const current = press.current;
    if (current && Math.hypot(evt.clientX - current.x, evt.clientY - current.y) > LONG_PRESS_SLOP) {
      cancel();
    }
  };

  const onContextMenu = (evt: MouseEvent<HTMLElement>) => {
    if (press.current || ending.current) evt.preventDefault();
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu,
  };
}
