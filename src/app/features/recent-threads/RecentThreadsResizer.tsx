import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as css from './recentThreads.css';

type RecentThreadsResizerProps = {
  panelHeight: number;
  minHeight: number;
  maxHeight: number;
  collapsedHeight: number;
  onPreviewHeightChange: (height: number) => void;
  onCommitHeightChange: (height: number) => void;
};

type DragState = {
  pointerId: number;
  startY: number;
  startHeight: number;
  lastHeight: number;
};

const KEYBOARD_RESIZE_STEP = 16;

const getResolvedHeight = (
  nextHeight: number,
  minHeight: number,
  maxHeight: number,
  collapsedHeight: number
): number => {
  const roundedHeight = Math.round(nextHeight);
  if (roundedHeight < minHeight) {
    return collapsedHeight;
  }

  return Math.min(Math.max(roundedHeight, minHeight), maxHeight);
};

export function RecentThreadsResizer({
  panelHeight,
  minHeight,
  maxHeight,
  collapsedHeight,
  onPreviewHeightChange,
  onCommitHeightChange,
}: RecentThreadsResizerProps) {
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<DragState | undefined>(undefined);

  const clearWindowListenersRef = useRef<() => void>(() => {});

  const commitResolvedHeight = useCallback(
    (nextHeight: number) => {
      const resolvedHeight = getResolvedHeight(nextHeight, minHeight, maxHeight, collapsedHeight);
      onPreviewHeightChange(resolvedHeight);
      onCommitHeightChange(resolvedHeight);
    },
    [collapsedHeight, maxHeight, minHeight, onCommitHeightChange, onPreviewHeightChange]
  );

  const handlePointerMove = useCallback(
    (evt: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || evt.pointerId !== dragState.pointerId) return;

      const deltaY = evt.clientY - dragState.startY;
      const nextHeight = getResolvedHeight(
        dragState.startHeight - deltaY,
        minHeight,
        maxHeight,
        collapsedHeight
      );

      dragState.lastHeight = nextHeight;
      onPreviewHeightChange(nextHeight);
    },
    [collapsedHeight, maxHeight, minHeight, onPreviewHeightChange]
  );

  const finishDrag = useCallback(
    (pointerId: number, commit: boolean) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== pointerId) return;

      dragStateRef.current = undefined;
      clearWindowListenersRef.current();
      setDragging(false);

      if (commit) {
        onCommitHeightChange(dragState.lastHeight);
        return;
      }

      onPreviewHeightChange(dragState.startHeight);
    },
    [onCommitHeightChange, onPreviewHeightChange]
  );

  const handlePointerUp = useCallback(
    (evt: PointerEvent) => {
      finishDrag(evt.pointerId, true);
    },
    [finishDrag]
  );

  const handlePointerCancel = useCallback(
    (evt: PointerEvent) => {
      finishDrag(evt.pointerId, false);
    },
    [finishDrag]
  );

  useEffect(
    () => () => {
      clearWindowListenersRef.current();
    },
    []
  );

  const handlePointerDown = (evt: React.PointerEvent<HTMLDivElement>) => {
    evt.preventDefault();
    clearWindowListenersRef.current();

    dragStateRef.current = {
      pointerId: evt.pointerId,
      startY: evt.clientY,
      startHeight: panelHeight,
      lastHeight: panelHeight,
    };
    setDragging(true);

    const clearWindowListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };

    clearWindowListenersRef.current = clearWindowListeners;

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
  };

  const handleKeyDown = (evt: React.KeyboardEvent<HTMLDivElement>) => {
    if (evt.key !== 'ArrowUp' && evt.key !== 'ArrowDown') return;

    evt.preventDefault();

    if (evt.key === 'ArrowUp') {
      const nextHeight =
        panelHeight <= collapsedHeight ? minHeight : panelHeight + KEYBOARD_RESIZE_STEP;
      commitResolvedHeight(nextHeight);
      return;
    }

    const nextHeight =
      panelHeight <= collapsedHeight || panelHeight - KEYBOARD_RESIZE_STEP < minHeight
        ? collapsedHeight
        : panelHeight - KEYBOARD_RESIZE_STEP;
    commitResolvedHeight(nextHeight);
  };

  return (
    <>
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div
        role="separator"
        aria-label="Resize recent threads panel"
        aria-orientation="horizontal"
        aria-valuemin={collapsedHeight}
        aria-valuemax={maxHeight}
        aria-valuenow={panelHeight}
        tabIndex={0}
        className={`${css.Resizer}${dragging ? ` ${css.ResizerActive}` : ''}`}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
      >
        <span className={css.ResizerLine} />
      </div>
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
    </>
  );
}
