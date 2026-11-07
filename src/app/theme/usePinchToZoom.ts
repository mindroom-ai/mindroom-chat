import { useEffect, useRef } from 'react';
import { touchDistance } from '../lib/hooks/useZoom';
import { sanitizeZoom } from '../preferences/settings';

const WHEEL_ZOOM_SENSITIVITY = 0.02;
// The image viewer pinches its own image; while it is open the page zoom leaves pinches alone.
const OPEN_IMAGE_VIEWER_SELECTOR = '[data-image-viewer="true"]';

type GestureEventWithScale = Event & { scale: number };

/**
 * A pinch changes the page zoom setting, so the interface reflows at the new size instead of
 * being magnified like a picture: two fingers on a touch screen, Safari's gesture events (a Mac
 * trackpad, and iOS alongside the touches), and ctrl with the wheel, which other browsers send
 * for a trackpad pinch. Each animation frame stores at most one new zoom.
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
    pendingZoomRef.current = null;
  }, [pageZoom]);

  useEffect(() => {
    setPageZoomRef.current = setPageZoom;
  }, [setPageZoom]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;

    const resetGestureState = () => {
      wheelDeltaRef.current = 0;
      touchStartDistanceRef.current = null;
      gestureStartZoomRef.current = null;
    };

    const shouldIgnorePinch = () => {
      const imageViewerOpen = document.querySelector(OPEN_IMAGE_VIEWER_SELECTOR) !== null;
      if (imageViewerOpen) resetGestureState();
      return imageViewerOpen;
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
      if (shouldIgnorePinch()) return;
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

    // One finger is no pinch: those touches (every scroll) return before the document query.
    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length >= 2 && shouldIgnorePinch()) return;
      startTouchPinch(event.touches);
    };

    const handleTouchMove = (event: TouchEvent) => {
      const startDistance = touchStartDistanceRef.current;
      if (event.touches.length < 2 || startDistance === null || startDistance <= 0) {
        touchStartDistanceRef.current = null;
        return;
      }
      if (shouldIgnorePinch()) return;
      const currentDistance = touchDistance(event.touches);
      if (!Number.isFinite(currentDistance) || currentDistance <= 0) return;
      // The pinch is the app's: the web view neither scrolls nor magnifies the page.
      if (event.cancelable) event.preventDefault();
      queueZoom(touchStartZoomRef.current * (currentDistance / startDistance));
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length >= 2) {
        if (!shouldIgnorePinch()) startTouchPinch(event.touches);
        return;
      }
      touchStartDistanceRef.current = null;
    };

    const handleGestureStart = (event: Event) => {
      if (shouldIgnorePinch()) return;
      if (event.cancelable) event.preventDefault();
      gestureStartZoomRef.current = pendingZoomRef.current ?? pageZoomRef.current;
    };

    const handleGestureChange = (event: Event) => {
      const { scale } = event as GestureEventWithScale;
      if (!Number.isFinite(scale) || scale <= 0) return;
      if (shouldIgnorePinch()) return;
      const startZoom =
        gestureStartZoomRef.current ?? pendingZoomRef.current ?? pageZoomRef.current;
      gestureStartZoomRef.current = startZoom;
      if (event.cancelable) event.preventDefault();
      queueZoom(startZoom * scale);
    };

    const handleGestureEnd = () => {
      gestureStartZoomRef.current = null;
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    document.addEventListener('gesturestart', handleGestureStart, { passive: false });
    document.addEventListener('gesturechange', handleGestureChange, { passive: false });
    document.addEventListener('gestureend', handleGestureEnd, { passive: true });

    return () => {
      if (rafIdRef.current !== undefined) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = undefined;
      }
      resetGestureState();
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
      document.removeEventListener('gesturestart', handleGestureStart);
      document.removeEventListener('gesturechange', handleGestureChange);
      document.removeEventListener('gestureend', handleGestureEnd);
    };
  }, []);
};
