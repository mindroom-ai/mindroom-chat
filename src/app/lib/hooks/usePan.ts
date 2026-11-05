import { PointerEvent, PointerEventHandler, useCallback, useEffect, useRef, useState } from 'react';

type Pan = {
  translateX: number;
  translateY: number;
};

type Point = { x: number; y: number };

/** Where a pan starts and where it returns when panning turns off. */
const INITIAL_PAN: Pan = { translateX: 0, translateY: 0 };

/**
 * Drag-to-pan for a zoomed element. One pointer pans; a second one (a pinch) suspends panning
 * until a single pointer is left. Turning `active` off recenters the element.
 */
export const usePan = (active: boolean) => {
  const [isPanning, setIsPanning] = useState(false);
  const [pan, setPan] = useState<Pan>(INITIAL_PAN);
  const pointersRef = useRef(new Map<number, Point>());
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (active) return;
    setPan(INITIAL_PAN);
    setIsPanning(false);
  }, [active]);

  const endPointer = useCallback((event: PointerEvent<HTMLElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.delete(event.pointerId)) return;
    setIsPanning(false);
  }, []);

  const onPointerDown: PointerEventHandler<HTMLElement> = useCallback((event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const pointers = pointersRef.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsPanning(activeRef.current && pointers.size === 1);
  }, []);

  const onPointerMove: PointerEventHandler<HTMLElement> = useCallback((event) => {
    const pointers = pointersRef.current;
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!activeRef.current || pointers.size !== 1) {
      setIsPanning(false);
      return;
    }
    event.preventDefault();
    const deltaX = event.clientX - previous.x;
    const deltaY = event.clientY - previous.y;
    setIsPanning(true);
    setPan((current) => ({
      translateX: current.translateX + deltaX,
      translateY: current.translateY + deltaY,
    }));
  }, []);

  let cursor = 'initial';
  if (active) cursor = isPanning ? 'grabbing' : 'grab';

  return {
    pan,
    setPan,
    cursor,
    isPanning,
    onPointerDown,
    onPointerMove,
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
    onLostPointerCapture: endPointer,
  };
};
