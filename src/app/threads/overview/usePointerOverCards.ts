import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type TouchEvent,
} from 'react';

/**
 * How long a mouse resting on the cards still holds them: a click comes within moments of the move
 * that aimed it, and a longer hold only delays the move the reader then sees anyway.
 */
export const MOUSE_REST_HOLD_MS = 700;

/**
 * Whether a pointer is over the cards, which holds their order, and the handlers of the card list
 * that follow it. A mouse is over them from its enter, or a move for a list drawn under a resting
 * pointer, until it leaves or rests for `MOUSE_REST_HOLD_MS`: a mouse parked over a list that fills
 * the view would otherwise keep it stale for as long as it rests, and its next move holds again.
 * A finger's pointer leaves as it lifts, before the tap's
 * mousedown, mouseup and click, and that mousedown moves focus off a card: let go there, a new
 * order would swap the cards between the mousedown and the mouseup, and the click would miss what
 * was tapped. A finger holds until its tap's click, or lets go at once after a pointercancel, when
 * it scrolled instead. A press holds as well, with no time limit until its release: React runs the
 * updates of a pointer's enter and moves at its continuous priority, and the press's focus change
 * renders at the discrete one, which can leave them out; the pointerdown is discrete too.
 */
export const usePointerOverCards = () => {
  // A mouse at rest lets go by time; a pen, a finger or a press never does, so they hold apart.
  const [mouseInside, setMouseInside] = useState(false);
  const [otherInside, setOtherInside] = useState(false);
  const cancelledRef = useRef(false);
  const releaseOnClickRef = useRef<() => void>();
  const restTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const stopResting = useCallback(() => {
    clearTimeout(restTimerRef.current);
    restTimerRef.current = undefined;
  }, []);
  const stopWaiting = useCallback(() => {
    const release = releaseOnClickRef.current;
    if (release) document.removeEventListener('click', release, true);
    releaseOnClickRef.current = undefined;
  }, []);
  useEffect(
    () => () => {
      stopWaiting();
      stopResting();
    },
    [stopResting, stopWaiting]
  );
  const letGo = useCallback(() => {
    setMouseInside(false);
    setOtherInside(false);
  }, []);
  const onPointerEnter = useCallback(
    (event?: PointerEvent<HTMLElement>) => {
      if (event?.pointerType !== 'mouse') {
        setOtherInside(true);
        return;
      }
      setMouseInside(true);
      stopResting();
      // A press holds until it is released; only a mouse at rest lets go.
      if (event.buttons) return;
      restTimerRef.current = setTimeout(() => setMouseInside(false), MOUSE_REST_HOLD_MS);
    },
    [stopResting]
  );
  const onPointerDown = useCallback(
    (event?: PointerEvent<HTMLElement>) => {
      if (event?.pointerType !== 'mouse') {
        setOtherInside(true);
        return;
      }
      stopResting();
      setMouseInside(true);
    },
    [stopResting]
  );
  const onPointerCancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);
  const onPointerLeave = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const cancelled = cancelledRef.current;
      cancelledRef.current = false;
      stopWaiting();
      if (event.pointerType === 'mouse' || cancelled) {
        stopResting();
        letGo();
        return;
      }
      // The click is already aimed when this runs, in the capture phase.
      const release = () => {
        stopWaiting();
        letGo();
      };
      releaseOnClickRef.current = release;
      document.addEventListener('click', release, true);
    },
    [letGo, stopResting, stopWaiting]
  );
  return {
    pointerInside: mouseInside || otherInside,
    onPointerEnter,
    onPointerMove: onPointerEnter,
    onPointerDown,
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse') onPointerEnter(event);
    },
    onPointerLeave,
    onPointerCancel,
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      // A long press consumes the release click, so there is no click left to wait for.
      if (!event.defaultPrevented) return;
      stopWaiting();
      letGo();
    },
  };
};
