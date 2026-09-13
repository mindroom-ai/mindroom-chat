import { MouseEventHandler, useCallback, useEffect, useRef, useState } from 'react';

export type Pan = {
  translateX: number;
  translateY: number;
};

const INITIAL_PAN = {
  translateX: 0,
  translateY: 0,
};

export const usePan = (active: boolean) => {
  const [pan, setPan] = useState<Pan>(INITIAL_PAN);
  const [cursor, setCursor] = useState<'grab' | 'grabbing' | 'initial'>(
    active ? 'grab' : 'initial'
  );

  useEffect(() => {
    setCursor(active ? 'grab' : 'initial');
  }, [active]);

  const handleMouseMoveRef = useRef<((evt: MouseEvent) => void) | null>(null);
  const handleMouseUpRef = useRef<((evt: MouseEvent) => void) | null>(null);

  const cleanupListeners = useCallback(() => {
    if (handleMouseMoveRef.current) {
      document.removeEventListener('mousemove', handleMouseMoveRef.current);
      handleMouseMoveRef.current = null;
    }
    if (handleMouseUpRef.current) {
      document.removeEventListener('mouseup', handleMouseUpRef.current);
      handleMouseUpRef.current = null;
    }
  }, []);

  const handleMouseDown: MouseEventHandler<HTMLElement> = (evt) => {
    if (!active) return;
    evt.preventDefault();
    setCursor('grabbing');

    // Clean up any stale listeners before adding new ones
    cleanupListeners();

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      setPan((p) => ({
        translateX: p.translateX + e.movementX,
        translateY: p.translateY + e.movementY,
      }));
    };

    const handleMouseUp = (e: MouseEvent) => {
      e.preventDefault();
      setCursor('grab');
      cleanupListeners();
    };

    handleMouseMoveRef.current = handleMouseMove;
    handleMouseUpRef.current = handleMouseUp;

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Cleanup on unmount or when active changes
  useEffect(() => {
    if (!active) {
      setPan(INITIAL_PAN);
      cleanupListeners();
    }
    return cleanupListeners;
  }, [active, cleanupListeners]);

  return {
    pan,
    cursor,
    onMouseDown: handleMouseDown,
  };
};
