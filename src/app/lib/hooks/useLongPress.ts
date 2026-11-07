import { TouchEvent, useEffect, useRef } from 'react';

/** How long a finger rests before the press counts as long, as touch platforms time it. */
export const LONG_PRESS_MS = 500;
/** How far a resting finger may drift, in CSS pixels, before the press becomes a scroll or drag. */
export const LONG_PRESS_SLOP = 10;
/**
 * How long a finger rests before the page's text turns unselectable: well before iOS selects the
 * word under it, about when the press fires, and longer than a finger that scrolls stays put. A
 * scroll thus leaves the page's style alone: restyling the whole page under a moving finger costs a
 * style pass, and the iOS web view drew the navigation drawer's badges and lists 34 px too high
 * until the finger had moved on.
 */
export const SELECTION_HOLD_MS = 150;

type Press = {
  timer: ReturnType<typeof setTimeout>;
  x: number;
  y: number;
  fired: boolean;
  stopWatchingScroll: () => void;
  releaseSelection: () => void;
};

// Presses holding the page's text unselectable; nested long-press elements both start one.
let selectionHolds = 0;

/**
 * Makes the page's text unselectable until the returned function runs. iOS selects the word under
 * a resting finger, and shows its Copy and Look Up bar, about when the press fires; once the menu
 * has opened under the finger it selects the menu's text instead. With nothing selectable it does
 * neither.
 */
const holdSelection = (): (() => void) => {
  const { style } = document.documentElement;
  if (selectionHolds === 0) {
    style.setProperty('-webkit-user-select', 'none');
    style.setProperty('user-select', 'none');
    style.setProperty('-webkit-touch-callout', 'none');
  }
  selectionHolds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    selectionHolds -= 1;
    if (selectionHolds > 0) return;
    style.removeProperty('-webkit-user-select');
    style.removeProperty('user-select');
    style.removeProperty('-webkit-touch-callout');
  };
};

/**
 * Touch handlers that call `onLongPress` with the finger's viewport point and the element they are
 * on once one finger has rested `LONG_PRESS_MS` on it. Moving more than `LONG_PRESS_SLOP`, a second finger,
 * any scroll on the page, lifting the finger or the browser cancelling the touch ends the press
 * first. iOS Safari fires no `contextmenu` on a long press, so this is how a finger opens a menu
 * there. Nothing prevents the browser's own handling while the finger rests, so scrolling works as
 * before, but once the finger has rested `SELECTION_HOLD_MS` no text is selectable until it lifts,
 * and a selection the page already had is cleared when the press fires: the menu is the long
 * press's only answer. Once the press fired, the lift does not also click. `canStart` decides per
 * touch whether a press may begin.
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
    current.releaseSelection();
    press.current = undefined;
  };

  // An element that unmounts mid-press stops its timer and lets the page's text be selected.
  useEffect(
    () => () => {
      if (press.current) clearTimeout(press.current.timer);
      press.current?.stopWatchingScroll();
      press.current?.releaseSelection();
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
      // A caret (the composer's, say) stays; selected text would keep its bar over the menu.
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) selection.removeAllRanges();
      latest.current(x, y, element);
    }, LONG_PRESS_MS);
    let releaseHeldSelection: (() => void) | undefined;
    const holdTimer = setTimeout(() => {
      releaseHeldSelection = holdSelection();
    }, SELECTION_HOLD_MS);
    press.current = {
      timer,
      x,
      y,
      fired: false,
      stopWatchingScroll: () => window.removeEventListener('scroll', onScroll, { capture: true }),
      releaseSelection: () => {
        clearTimeout(holdTimer);
        releaseHeldSelection?.();
      },
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
