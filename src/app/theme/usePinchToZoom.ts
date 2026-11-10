import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { touchDistance } from '../lib/hooks/useZoom';
import { sanitizeZoom } from '../preferences/settings';

const WHEEL_ZOOM_SENSITIVITY = 0.02;
// Ctrl with the wheel has no end: a surface's pinch from it ends once the wheel rests this long.
const WHEEL_PINCH_REST_MS = 200;
// One notch of a mouse wheel, as Chromium sends it in pixels. A wheel that sends lines sends three
// a notch, and one that sends pages one, so each counts as this share of a notch.
const WHEEL_NOTCH_PX = 100;

/** Ctrl with the wheel's `deltaY` in pixels, so a notch zooms one step in every `deltaMode`. */
const wheelPixels = ({ deltaY, deltaMode }: WheelEvent): number => {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return (deltaY * WHEEL_NOTCH_PX) / 3;
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return deltaY * WHEEL_NOTCH_PX;
  return deltaY;
};

/**
 * Marks an element that handles pinches over it itself, such as the image viewer or a plugin's
 * board: the page zoom leaves them to it (docs/architecture.md "Client plugins").
 */
export const PINCH_SURFACE_ATTRIBUTE = 'data-pinch-surface';
const PINCH_SURFACE_SELECTOR = `[${PINCH_SURFACE_ATTRIBUTE}]`;

type GestureEventWithScale = Event & { scale: number; clientX: number; clientY: number };

/**
 * A pinch the page zoom hands a surface of `usePinchSurface`: `scale` against the pinch's start,
 * and `centre` in client coordinates. Each `start` is followed by `move`s and then one `end`.
 */
export type SurfacePinch = {
  phase: 'start' | 'move' | 'end';
  scale: number;
  centre: { x: number; y: number };
};

type PinchListener = { current: (pinch: SurfacePinch) => void };

// The surfaces of usePinchSurface, by their element, with the newest onPinch of each.
const pinchListeners = new WeakMap<Element, PinchListener>();

// The page zoom's end of the pinch it handed a surface, for a surface that goes mid-pinch.
let endPinchOf: ((surface: Element) => void) | undefined;

/**
 * Unmarks `element`, which the page zoom then finds no surface; its pinch under way ends now, with
 * the onPinch it had.
 */
const unregisterSurface = (element: Element | null) => {
  if (!element) return;
  element.removeAttribute(PINCH_SURFACE_ATTRIBUTE);
  endPinchOf?.(element);
  // A touch pinch it owned stays its own until it ends, but nothing is handed on any more.
  pinchListeners.delete(element);
};

/**
 * Marks `ref`'s element as a pinch surface and hands `onPinch` each pinch the page zoom leaves to
 * it, by the rule that decides which pinches are a surface's: the page zoom then also keeps the
 * browser from zooming or scrolling the page for them (docs/architecture.md "Client plugins").
 */
export const usePinchSurface = (
  ref: RefObject<HTMLElement>,
  { onPinch }: { onPinch: (pinch: SurfacePinch) => void }
): void => {
  const listener = useRef(onPinch);
  const registered = useRef<HTMLElement | null>(null);
  // After each render, since the element may be another one by then. A pinch of the element that
  // went ends before the newest onPinch is taken, with that element's onPinch.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element !== registered.current) {
      unregisterSurface(registered.current);
      registered.current = element;
      if (element) {
        element.setAttribute(PINCH_SURFACE_ATTRIBUTE, '');
        pinchListeners.set(element, listener);
      }
    }
    listener.current = onPinch;
  });
  useLayoutEffect(
    () => () => {
      unregisterSurface(registered.current);
      // Mounted again (StrictMode), it marks its element again.
      registered.current = null;
    },
    []
  );
};

const gestureCentre = (event: Event): SurfacePinch['centre'] => {
  const { clientX, clientY } = event as GestureEventWithScale;
  return { x: clientX, y: clientY };
};

const surfaceAt = (target: EventTarget | null): Element | null =>
  target instanceof Element ? target.closest(PINCH_SURFACE_SELECTOR) : null;

/**
 * The marked element every finger landed in, the innermost that holds them all when marks nest:
 * `Touch.target` stays where a finger landed.
 */
const surfaceOwning = (touches: TouchList): Element | null => {
  const targets = Array.from(touches, (finger) => finger.target);
  const holdsAll = (surface: Element) =>
    targets.every((target) => target instanceof Node && surface.contains(target));
  let surface = surfaceAt(targets[0] ?? null);
  while (surface && !holdsAll(surface)) surface = surfaceAt(surface.parentElement);
  return surface;
};

/**
 * A pinch changes the page zoom setting, so the interface reflows at the new size instead of
 * being magnified like a picture: two fingers on a touch screen, Safari's gesture events (a Mac
 * trackpad, and iOS alongside the touches), and ctrl with the wheel, which other browsers send
 * for a trackpad pinch. Each animation frame stores at most one new zoom. A pinch over an element
 * with PINCH_SURFACE_ATTRIBUTE is that element's own, and goes to its onPinch if usePinchSurface
 * marked it.
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

    // The pinch under way: how many fingers are down, by each touch event's `touches`, and
    // the pinch surface that owns it, decided as the second finger lands. A pinch ends only in
    // forgetPinch, which drops its gesture's start too, at the first of: a touch event with fewer
    // than two fingers, the gesture's end, and a touch pointer end that leaves fewer than two
    // down. The pointers are a set of their own, so a finger counts once whichever of its events
    // comes first, and they end on the window even when every finger's element went and no touch
    // event comes, so nothing outlives the pinch.
    let fingers = 0;
    let surfacePinch: Element | null = null;
    const pointersDown = new Set<number>();

    // The pinch handed to a surface's onPinch: what it comes from, for a touch pinch the two
    // fingers it measures and their distance at its start, and what it sent last, which its end
    // repeats. One pinch at a time: a new one ends it first.
    let handed: {
      surface: Element;
      listener: PinchListener;
      from: 'touch' | 'gesture' | 'wheel';
      fingers: [number, number] | null;
      distance: number;
      last: SurfacePinch;
    } | null = null;
    let wheelRest: number | undefined;
    // A gesture that started over a surface with no finger down, a trackpad's unless a touch shows
    // otherwise before it first changes.
    let trackpadGesture: { surface: Element; centre: SurfacePinch['centre'] } | null = null;
    endPinchOf = (surface) => {
      if (handed?.surface === surface) endHanded();
    };

    const endHanded = () => {
      const pinch = handed;
      if (!pinch) return;
      handed = null;
      pinch.listener.current({ ...pinch.last, phase: 'end' });
    };

    /**
     * Starts a pinch of `surface`'s, ending the one under way, if usePinchSurface marked it;
     * false if it did not.
     */
    const startHanded = (
      surface: Element,
      from: 'touch' | 'gesture' | 'wheel',
      centre: SurfacePinch['centre'],
      fingersMeasured: [number, number] | null = null,
      distance = 0
    ): boolean => {
      const listener = pinchListeners.get(surface);
      if (!listener) return false;
      endHanded();
      const last: SurfacePinch = { phase: 'start', scale: 1, centre };
      handed = { surface, listener, from, fingers: fingersMeasured, distance, last };
      listener.current(last);
      return true;
    };

    const moveHanded = (scale: number, centre: SurfacePinch['centre']) => {
      if (!handed) return;
      handed.last = { phase: 'move', scale, centre };
      handed.listener.current(handed.last);
    };

    /**
     * Hands the surface that owns the touch pinch its first two fingers' spread and midpoint as
     * they move; once they are other fingers, which a finger that lands or lifts can make them,
     * its pinch starts again from them, so neither jumps.
     */
    const handTouches = (surface: Element, touches: TouchList, moved: boolean) => {
      const [first, second] = [touches[0], touches[1]];
      if (!first || !second) return;
      const centre = {
        x: (first.clientX + second.clientX) / 2,
        y: (first.clientY + second.clientY) / 2,
      };
      const distance = touchDistance(touches);
      const same =
        handed?.from === 'touch' &&
        handed.fingers?.[0] === first.identifier &&
        handed.fingers[1] === second.identifier;
      if (!same) {
        startHanded(surface, 'touch', centre, [first.identifier, second.identifier], distance);
        return;
      }
      // Fingers that landed on one point measure no spread to scale against.
      if (!moved || !handed || handed.distance <= 0) return;
      moveHanded(distance / handed.distance, centre);
    };

    const forgetPinch = () => {
      fingers = 0;
      surfacePinch = null;
      gestureStartZoomRef.current = null;
      trackpadGesture = null;
      endHanded();
    };

    /** Follows the fingers of `event`; the surface whose pinch they make, if any. */
    const followFingers = (event: TouchEvent): Element | null => {
      const pinchStarts = fingers < 2 && event.touches.length >= 2;
      // Fewer than two fingers are down: the pinch has ended, and its gesture, whose end may
      // have been lost, with it.
      if (fingers >= 2 && event.touches.length < 2) forgetPinch();
      fingers = event.touches.length;
      // No finger is down: a pointer whose end the window never saw is not down either.
      if (fingers === 0) pointersDown.clear();
      const owner = pinchStarts ? surfaceOwning(event.touches) : null;
      if (owner) {
        surfacePinch = owner;
        // A start an earlier pinch left, whose ends were lost, never zooms these fingers later.
        touchStartDistanceRef.current = null;
      }
      if (surfacePinch) handTouches(surfacePinch, event.touches, event.type === 'touchmove');
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

    // A surface's pinch from ctrl and the wheel: their deltas, folded into one scale as Chromium
    // makes them from a trackpad's.
    const handWheel = (surface: Element, event: WheelEvent, deltaY: number) => {
      const centre = { x: event.clientX, y: event.clientY };
      const goesOn = handed?.from === 'wheel' && handed.surface === surface;
      if (!goesOn && !startHanded(surface, 'wheel', centre)) return;
      if (event.cancelable) event.preventDefault();
      moveHanded((handed?.last.scale ?? 1) * Math.exp(-deltaY / 100), centre);
      window.clearTimeout(wheelRest);
      wheelRest = window.setTimeout(() => {
        if (handed?.from === 'wheel') endHanded();
      }, WHEEL_PINCH_REST_MS);
    };

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !Number.isFinite(event.deltaY)) return;
      const deltaY = wheelPixels(event);
      const surface = surfaceAt(event.target);
      if (surface !== null) {
        handWheel(surface, event, deltaY);
        return;
      }
      if (event.cancelable) event.preventDefault();

      wheelDeltaRef.current += -deltaY * WHEEL_ZOOM_SENSITIVITY;
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
      if (followFingers(event)) {
        // The pinch is a surface's that zooms itself: the web view neither scrolls nor magnifies.
        if (handed?.from === 'touch' && event.cancelable) event.preventDefault();
        return;
      }
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
    // go with the touch pinch's owner, whose onPinch has the touches. Its gesturestart may come
    // before the second finger's touchstart, and a trackpad pinch has only the gesture: with no
    // touch pinch under way, the gesture's target decides. With no finger down at all, by its
    // touches and its pointers, until it first changes, it is a trackpad's, which the surface's
    // onPinch gets from the gesture.
    const handleGestureStart = (event: Event) => {
      gestureStartZoomRef.current = null;
      if (handed?.from === 'gesture') endHanded();
      const surface = surfaceAt(event.target);
      if (surfacePinch || (fingers < 2 && surface !== null)) {
        if (fingers === 0 && pointersDown.size === 0 && surface) {
          trackpadGesture = { surface, centre: gestureCentre(event) };
        }
        const owner = surfacePinch ?? surface;
        if (owner && pinchListeners.has(owner) && event.cancelable) event.preventDefault();
        return;
      }
      if (event.cancelable) event.preventDefault();
      gestureStartZoomRef.current = pendingZoomRef.current ?? pageZoomRef.current;
    };

    // Only a gesture whose start was the app's zooms the page: one that started elsewhere never
    // jumps the page zoom to its own scale midway.
    const handleGestureChange = (event: Event) => {
      const { scale } = event as GestureEventWithScale;
      const startZoom = gestureStartZoomRef.current;
      if (surfacePinch || startZoom === null) {
        const trackpad = trackpadGesture;
        trackpadGesture = null;
        if (trackpad && fingers === 0) {
          startHanded(trackpad.surface, 'gesture', trackpad.centre);
        }
        const fromGesture = handed?.from === 'gesture';
        if (fromGesture) moveHanded(scale, gestureCentre(event));
        const zoomsItself = fromGesture || (surfacePinch && pinchListeners.has(surfacePinch));
        if (zoomsItself && event.cancelable) event.preventDefault();
        return;
      }
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
      // A wheel's pinch then has nothing for its rest to end.
      endHanded();
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
