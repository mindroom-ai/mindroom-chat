import { useCallback, useEffect, useRef, useState } from 'react';

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;

const clampZoom = (zoom: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, zoom));

/** The distance between the first two touches; 0 with fewer than two. */
export const touchDistance = (touches: TouchList): number => {
  const first = touches[0];
  const second = touches[1];
  if (!first || !second) return 0;
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
};

/**
 * Zoom for a media viewer: buttons step it by `step`, a two-finger pinch on the element passed
 * to `zoomTargetRef` scales it, and ctrl or cmd with the wheel steps it. Zoom stays within
 * `min` and `max`.
 */
export const useZoom = (step: number, min = ZOOM_MIN, max = ZOOM_MAX) => {
  const [zoom, setZoomState] = useState(1);
  const [isZooming, setIsZooming] = useState(false);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const setZoom = useCallback(
    (next: number | ((current: number) => number)) => {
      setZoomState((current) =>
        clampZoom(typeof next === 'function' ? next(current) : next, min, max)
      );
    },
    [min, max]
  );

  const zoomIn = useCallback(() => setZoom((current) => current + step), [setZoom, step]);
  const zoomOut = useCallback(() => setZoom((current) => current - step), [setZoom, step]);

  const zoomTargetRef = useCallback((element: HTMLElement | null) => setTarget(element), []);

  useEffect(() => {
    if (!target) return undefined;
    let pinch: { distance: number; zoom: number } | undefined;

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length < 2) return;
      const distance = touchDistance(event.touches);
      if (distance <= 0) return;
      pinch = { distance, zoom: zoomRef.current };
    };
    const handleTouchMove = (event: TouchEvent) => {
      if (!pinch || event.touches.length < 2) return;
      if (event.cancelable) event.preventDefault();
      const scale = touchDistance(event.touches) / pinch.distance;
      setIsZooming(true);
      setZoom(pinch.zoom * scale);
    };
    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length >= 2) return;
      pinch = undefined;
      setIsZooming(false);
    };
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((current) => (event.deltaY < 0 ? current + step : current - step));
    };

    target.addEventListener('touchstart', handleTouchStart, { passive: true });
    target.addEventListener('touchmove', handleTouchMove, { passive: false });
    target.addEventListener('touchend', handleTouchEnd);
    target.addEventListener('touchcancel', handleTouchEnd);
    target.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      target.removeEventListener('touchstart', handleTouchStart);
      target.removeEventListener('touchmove', handleTouchMove);
      target.removeEventListener('touchend', handleTouchEnd);
      target.removeEventListener('touchcancel', handleTouchEnd);
      target.removeEventListener('wheel', handleWheel);
    };
  }, [target, setZoom, step]);

  return { zoom, zoomIn, zoomOut, setZoom, zoomTargetRef, isZooming };
};
