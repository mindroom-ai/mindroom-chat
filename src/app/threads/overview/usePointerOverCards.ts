import { useEffect, useRef, useState, type PointerEvent, type TouchEvent } from 'react';

/** How long a mouse resting on the cards still holds them before letting go. */
export const MOUSE_REST_HOLD_MS = 700;

/**
 * Whether a pointer is over the cards, holding their order. A mouse holds until it leaves or
 * rests for `MOUSE_REST_HOLD_MS` (a press holds until release, and pointerdown is discrete so
 * focus changes cannot drop it). A touch holds past pointerleave until its tap's capture click
 * so a reorder cannot swap cards between mousedown and mouseup; pointercancel lets go at once.
 */
export const usePointerOverCards = () => {
  // A mouse at rest lets go by time; a pen, a finger or a press never does, so they hold apart.
  const [mouseInside, setMouseInside] = useState(false);
  const [otherInside, setOtherInside] = useState(false);
  const stateRef = useRef<{
    cancelled: boolean;
    releaseOnClick?: () => void;
    restTimer?: ReturnType<typeof setTimeout>;
  }>({ cancelled: false });
  const state = stateRef.current;

  const stopResting = () => {
    clearTimeout(state.restTimer);
    state.restTimer = undefined;
  };
  const stopWaiting = () => {
    if (state.releaseOnClick) {
      document.removeEventListener('click', state.releaseOnClick, true);
      state.releaseOnClick = undefined;
    }
  };
  const letGo = () => {
    setMouseInside(false);
    setOtherInside(false);
  };
  useEffect(
    () => () => {
      stopWaiting();
      stopResting();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `state` is a stable ref
    []
  );

  const holdPointer = (event: PointerEvent<HTMLElement> | undefined, allowRest: boolean) => {
    if (event?.pointerType !== 'mouse') {
      setOtherInside(true);
      return;
    }
    setMouseInside(true);
    stopResting();
    if (allowRest && !event.buttons) {
      state.restTimer = setTimeout(() => setMouseInside(false), MOUSE_REST_HOLD_MS);
    }
  };
  const onPointerEnter = (event?: PointerEvent<HTMLElement>) => holdPointer(event, true);

  return {
    pointerInside: mouseInside || otherInside,
    onPointerEnter,
    onPointerMove: onPointerEnter,
    onPointerDown: (event?: PointerEvent<HTMLElement>) => holdPointer(event, false),
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse') onPointerEnter(event);
    },
    onPointerCancel: () => {
      state.cancelled = true;
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      const { cancelled } = state;
      state.cancelled = false;
      stopWaiting();
      if (event.pointerType === 'mouse' || cancelled) {
        stopResting();
        letGo();
        return;
      }
      state.releaseOnClick = () => {
        stopWaiting();
        letGo();
      };
      document.addEventListener('click', state.releaseOnClick, true);
    },
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      // A long press consumes the release click, so there is no click left to wait for.
      if (!event.defaultPrevented) return;
      stopWaiting();
      letGo();
    },
  };
};
