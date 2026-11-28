import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { DragStartEvent } from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';
import { preventClickDefaultsDuringPointerDrag } from '../../lib/sortableDrag';

const EDGE_ZONE_PX = 48;
const PAN_STEP_PX = 12;

export const isCompactBoardRtl = (board: HTMLElement | null): boolean =>
  !!board &&
  (getComputedStyle(board).direction ||
    board.closest('[dir]')?.getAttribute('dir')?.toLowerCase()) === 'rtl';

/** dnd-kit's autoscroller assumes non-negative scrollLeft; RTL scrolls from 0 toward -max. */
const startRtlPan = (board: HTMLDivElement, activatorEvent: Event) => {
  const win = board.ownerDocument.defaultView;
  if (!win) return undefined;
  const moveEvent = activatorEvent.type === 'touchstart' ? 'touchmove' : 'mousemove';
  let frame = 0;
  let clientX: number | undefined;
  const pan = () => {
    frame = 0;
    if (clientX === undefined) return;
    const { left, right } = board.getBoundingClientRect();
    const atLeft = clientX < left + EDGE_ZONE_PX;
    if (!atLeft && clientX <= right - EDGE_ZONE_PX) return;
    const step = atLeft ? -PAN_STEP_PX : PAN_STEP_PX;
    const min = Math.min(0, board.clientWidth - board.scrollWidth);
    const next = Math.max(min, Math.min(0, board.scrollLeft + step));
    if (next === board.scrollLeft) return;
    board.scrollLeft = next;
    frame = win.requestAnimationFrame(pan);
  };
  const onMove = (event: Event) => {
    clientX = getEventCoordinates(event)?.x;
    if (!frame) frame = win.requestAnimationFrame(pan);
  };
  // The sensor starts in a descendant's move handler, before that same move reaches the window.
  win.addEventListener(moveEvent, onMove, { passive: true });
  return () => {
    win.removeEventListener(moveEvent, onMove);
    win.cancelAnimationFrame(frame);
  };
};

export const useCompactColumnDrag = (boardRef: RefObject<HTMLDivElement | null>) => {
  const [rtl, setRtl] = useState(false);
  const updateDirection = useCallback(() => {
    const next = isCompactBoardRtl(boardRef.current);
    setRtl(next);
    return next;
  }, [boardRef]);
  useLayoutEffect(() => {
    updateDirection();
  });
  useLayoutEffect(() => {
    const observer = new MutationObserver(updateDirection);
    for (let el: HTMLElement | null = boardRef.current; el; el = el.parentElement) {
      observer.observe(el, { attributeFilter: ['dir'] });
    }
    return () => observer.disconnect();
  }, [boardRef, updateDirection]);

  const cleanupRef = useRef<(() => void) | undefined>(undefined);
  const stopPan = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = undefined;
  }, []);
  useLayoutEffect(() => stopPan, [stopPan]);
  const handleDragStart = useCallback(
    ({ activatorEvent }: DragStartEvent) => {
      stopPan();
      preventClickDefaultsDuringPointerDrag(activatorEvent);
      const board = boardRef.current;
      if (updateDirection() && board) cleanupRef.current = startRtlPan(board, activatorEvent);
    },
    [boardRef, stopPan, updateDirection]
  );
  return { rtl, handleDragStart, stopPan };
};
