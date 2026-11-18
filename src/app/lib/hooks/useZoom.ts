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

/** A point as its offset from the zoomed element's centre, where its scale is anchored. */
export type ZoomOffset = { x: number; y: number };

/**
 * A wheel or pinch zoom from `from` to `to`: the content at `before` should end up at `at`. They
 * differ only when the fingers move as they pinch.
 */
export type ZoomStep = { from: number; to: number; at: ZoomOffset; before: ZoomOffset };
export type ZoomAround = (step: ZoomStep) => void;

const offsetFromCentre = (element: Element, clientX: number, clientY: number): ZoomOffset => {
  const rect = element.getBoundingClientRect();
  return { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) };
};

/**
 * Zoom for a media viewer: buttons step it by `step`, a two-finger pinch on the element passed
 * to `zoomTargetRef` scales it, and ctrl or cmd with the wheel steps it. Zoom stays within
 * `min` and `max`. A wheel or pinch zoom aims at the cursor or the fingers: `onZoomAround`
 * hears where, so the owner can move the content to keep that point still.
 */
export const useZoom = (
  step: number,
  min = ZOOM_MIN,
  max = ZOOM_MAX,
  onZoomAround?: ZoomAround
) => {
  const [zoom, setZoomState] = useState(1);
  const [isZooming, setIsZooming] = useState(false);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  // Ahead of the state, so wheel events between two renders each start where the last one left.
  const zoomRef = useRef(zoom);
  const zoomAroundRef = useRef(onZoomAround);
  zoomAroundRef.current = onZoomAround;

  const setZoom = useCallback(
    (next: number | ((current: number) => number), at?: ZoomOffset, before = at) => {
      const from = zoomRef.current;
      const wanted = clampZoom(typeof next === 'function' ? next(from) : next, min, max);
      // Rounded, so steps back from 2 land on exactly 1 (fit), not 1.0000000000000002.
      const to = Math.round(wanted * 1e6) / 1e6;
      if (to === from) return;
      zoomRef.current = to;
      setZoomState(to);
      if (at && before) zoomAroundRef.current?.({ from, to, at, before });
    },
    [min, max]
  );

  const zoomIn = useCallback(() => setZoom((current) => current + step), [setZoom, step]);
  const zoomOut = useCallback(() => setZoom((current) => current - step), [setZoom, step]);

  const zoomTargetRef = useCallback((element: HTMLElement | null) => setTarget(element), []);

  useEffect(() => {
    if (!target) return undefined;
    let pinch: { distance: number; zoom: number; centre: ZoomOffset } | undefined;
    const touchCentre = (touches: TouchList): ZoomOffset => {
      const [first, second] = [touches[0]!, touches[1]!];
      return offsetFromCentre(
        target,
        (first.clientX + second.clientX) / 2,
        (first.clientY + second.clientY) / 2
      );
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length < 2) return;
      const distance = touchDistance(event.touches);
      if (distance <= 0) return;
      pinch = { distance, zoom: zoomRef.current, centre: touchCentre(event.touches) };
    };
    const handleTouchMove = (event: TouchEvent) => {
      if (!pinch || event.touches.length < 2) return;
      if (event.cancelable) event.preventDefault();
      const scale = touchDistance(event.touches) / pinch.distance;
      // The content under the fingers' last midpoint follows them to the new one.
      const centre = touchCentre(event.touches);
      const before = pinch.centre;
      pinch.centre = centre;
      setIsZooming(true);
      setZoom(pinch.zoom * scale, centre, before);
    };
    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length >= 2) return;
      pinch = undefined;
      setIsZooming(false);
    };
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(
        (current) => (event.deltaY < 0 ? current + step : current - step),
        offsetFromCentre(target, event.clientX, event.clientY)
      );
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
