import { useEffect, useRef } from 'react';
import { touchDistance } from '../lib/hooks/useZoom';
import { sanitizeZoom } from '../preferences/settings';

const WHEEL_ZOOM_SENSITIVITY = 0.02;

/**
 * Marks an element that handles pinches over it itself, such as the image viewer or a plugin's
 * board: the page zoom leaves them to it (docs/architecture.md "Client plugins").
 */
export const PINCH_SURFACE_ATTRIBUTE = 'data-pinch-surface';
const PINCH_SURFACE_SELECTOR = `[${PINCH_SURFACE_ATTRIBUTE}]`;

type GestureEventWithScale = Event & { scale: number };

const surfaceAt = (target: EventTarget | null): Element | null =>
  target instanceof Element ? target.closest(PINCH_SURFACE_SELECTOR) : null;

/** Whether every finger landed in one marked element: `Touch.target` stays where it landed. */
const surfaceOwns = (touches: TouchList): boolean => {
  const fingers = Array.from(touches);
  const surface = surfaceAt(fingers[0]?.target ?? null);
  return surface !== null && fingers.every((finger) => surfaceAt(finger.target) === surface);
};

/**
 * A pinch changes the page zoom setting, so the interface reflows at the new size instead of
 * being magnified like a picture: two fingers on a touch screen, Safari's gesture events (a Mac
 * trackpad, and iOS alongside the touches), and ctrl with the wheel, which other browsers send
 * for a trackpad pinch. Each animation frame stores at most one new zoom. A pinch over an element
 * with PINCH_SURFACE_ATTRIBUTE is that element's own.
 */
export const usePinchToZoom = (pageZoom: number, setPageZoom: (zoom: number) => void): void => {
  const pageZoomRef = useRef(pageZoom);
  const setPageZoomRef = useRef(setPageZoom);
  const pendingZoomRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | undefined>(undefined);
  const wheelDeltaRef = useRef(0);
  const touchStartDistanceRef = useRef<number | null>(null);
  const touchStartZoomRef = useRef(pageZoom);
  const gestureStartZoomRef = useRef<number | null>(null);

  useEffect(() => {
    pageZoomRef.current = pageZoom;
    // A zoom the fingers reached while this one was being stored still waits for its frame.
    if (pendingZoomRef.current === pageZoom) pendingZoomRef.current = null;
  }, [pageZoom]);

  useEffect(() => {
    setPageZoomRef.current = setPageZoom;
  }, [setPageZoom]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    // The pinch under way, from the touch event that brings a second finger down until fewer
    // than two are: how many fingers are down, and whether a pinch surface owns it. Each touch
    // event that reaches the window sets the count from its `touches`; a finger whose element
    // went is still counted there, and the pinch keeps the owner it started with. When every
    // finger's element went, no touch event comes, but each finger's pointer still ends on
    // the window, and so does the gesture; a touch pointer that ends with fewer than two left down,
    // or the gesture's end, forgets the pinch and its gesture, so nothing outlives it. The touch
    // pointers down are kept apart from the count, so a finger that lifts counts once, whichever
    // of its two events comes first.
    let fingers = 0;
    let surfacePinch = false;
    const pointersDown = new Set<number>();

    const forgetPinch = () => {
      fingers = 0;
      surfacePinch = false;
      gestureStartZoomRef.current = null;
    };

    /** Follows the fingers of `event`; true while the pinch they make is a surface's. */
    const followFingers = (event: TouchEvent): boolean => {
      const pinchStarts = fingers < 2 && event.touches.length >= 2;
      fingers = event.touches.length;
      // No finger is down: a pointer whose end the window never saw is not down either.
      if (fingers === 0) pointersDown.clear();
      if (fingers < 2) surfacePinch = false;
      else if (pinchStarts && surfaceOwns(event.touches)) {
        surfacePinch = true;
        // A start an earlier pinch left, whose ends were lost, never zooms these fingers later.
        touchStartDistanceRef.current = null;
      }
      return surfacePinch;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') pointersDown.add(event.pointerId);
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      pointersDown.delete(event.pointerId);
      if (pointersDown.size < 2) forgetPinch();
    };

    const flushPendingZoom = () => {
      rafIdRef.current = undefined;
      const pendingZoom = pendingZoomRef.current;
      pendingZoomRef.current = null;
      if (pendingZoom === null || pendingZoom === pageZoomRef.current) return;
      pageZoomRef.current = pendingZoom;
      setPageZoomRef.current(pendingZoom);
    };

    const queueZoom = (nextZoom: number) => {
      const safeZoom = sanitizeZoom(nextZoom);
      const currentZoom = pendingZoomRef.current ?? pageZoomRef.current;
      if (safeZoom === currentZoom) return;
      pendingZoomRef.current = safeZoom;
      if (rafIdRef.current !== undefined) return;
      rafIdRef.current = window.requestAnimationFrame(flushPendingZoom);
    };

    const startTouchPinch = (touches: TouchList) => {
      if (touches.length < 2) {
        touchStartDistanceRef.current = null;
        return;
      }
      touchStartDistanceRef.current = touchDistance(touches);
      touchStartZoomRef.current = pendingZoomRef.current ?? pageZoomRef.current;
    };

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !Number.isFinite(event.deltaY)) return;
      if (surfaceAt(event.target) !== null) return;
      if (event.cancelable) event.preventDefault();

      wheelDeltaRef.current += -event.deltaY * WHEEL_ZOOM_SENSITIVITY;
      const wholeDelta =
        wheelDeltaRef.current > 0
          ? Math.floor(wheelDeltaRef.current)
          : Math.ceil(wheelDeltaRef.current);
      if (wholeDelta === 0) return;

      const baseZoom = pendingZoomRef.current ?? pageZoomRef.current;
      const nextZoom = sanitizeZoom(baseZoom + wholeDelta);
      const consumedDelta = nextZoom - baseZoom;
      if (consumedDelta === 0) {
        wheelDeltaRef.current = 0;
        return;
      }
      wheelDeltaRef.current -= consumedDelta;
      queueZoom(nextZoom);
    };

    // A finger lands or lifts. One finger is no pinch: a surface's element is looked up only as a
    // second finger lands.
    const handleFingersChange = (event: TouchEvent) => {
      if (followFingers(event)) return;
      startTouchPinch(event.touches);
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (followFingers(event)) return;
      const startDistance = touchStartDistanceRef.current;
      if (event.touches.length < 2 || startDistance === null || startDistance <= 0) {
        touchStartDistanceRef.current = null;
        return;
      }
      const currentDistance = touchDistance(event.touches);
      if (!Number.isFinite(currentDistance) || currentDistance <= 0) return;
      // The pinch is the app's: the web view neither scrolls nor magnifies the page.
      if (event.cancelable) event.preventDefault();
      queueZoom(touchStartZoomRef.current * (currentDistance / startDistance));
    };

    // iOS sends the gesture events of a touch pinch to the elements its fingers landed on: they
    // go with the touch pinch's owner. Its gesturestart may come before the second finger's
    // touchstart, and a trackpad pinch has only the gesture: with no touch pinch under way, the
    // gesture's target decides.
    const handleGestureStart = (event: Event) => {
      gestureStartZoomRef.current = null;
      if (surfacePinch || (fingers < 2 && surfaceAt(event.target) !== null)) return;
      if (event.cancelable) event.preventDefault();
      gestureStartZoomRef.current = pendingZoomRef.current ?? pageZoomRef.current;
    };

    // Only a gesture whose start was the app's zooms the page: one that started elsewhere never
    // jumps the page zoom to its own scale midway.
    const handleGestureChange = (event: Event) => {
      const { scale } = event as GestureEventWithScale;
      const startZoom = gestureStartZoomRef.current;
      if (surfacePinch || startZoom === null) return;
      if (!Number.isFinite(scale) || scale <= 0) return;
      if (event.cancelable) event.preventDefault();
      queueZoom(startZoom * scale);
    };

    const handleGestureEnd = forgetPinch;

    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('touchstart', handleFingersChange, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleFingersChange, { passive: true });
    window.addEventListener('touchcancel', handleFingersChange, { passive: true });
    document.addEventListener('gesturestart', handleGestureStart, { passive: false });
    document.addEventListener('gesturechange', handleGestureChange, { passive: false });
    document.addEventListener('gestureend', handleGestureEnd, { passive: true });
    window.addEventListener('pointerdown', handlePointerDown, { passive: true });
    window.addEventListener('pointerup', handlePointerEnd, { passive: true });
    window.addEventListener('pointercancel', handlePointerEnd, { passive: true });

    return () => {
      if (rafIdRef.current !== undefined) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = undefined;
      }
      pendingZoomRef.current = null;
      wheelDeltaRef.current = 0;
      touchStartDistanceRef.current = null;
      gestureStartZoomRef.current = null;
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('touchstart', handleFingersChange);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleFingersChange);
      window.removeEventListener('touchcancel', handleFingersChange);
      document.removeEventListener('gesturestart', handleGestureStart);
      document.removeEventListener('gesturechange', handleGestureChange);
      document.removeEventListener('gestureend', handleGestureEnd);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, []);
};
