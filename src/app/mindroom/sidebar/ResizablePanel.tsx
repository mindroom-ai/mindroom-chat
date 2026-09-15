import React, { ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../state/utils/atomWithLocalStorage';
import * as css from './ResizablePanel.css';

const MIN_WIDTH = 200;
const MAX_WIDTH = 600;
const COLLAPSE_WIDTH = MIN_WIDTH - 40;
const COLLAPSE_HYSTERESIS = 20;
const clamp = (width: number, max: number) =>
  Math.min(Math.max(Math.min(MIN_WIDTH, max), width), max);
const readWidth = (key: string): number | undefined => {
  const value = getLocalStorageItem<unknown>(key, undefined);
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? clamp(value, MAX_WIDTH)
    : undefined;
};

type Drag = {
  pointerId: number;
  startX: number;
  startWidth: number;
  width: number;
  direction: number;
  collapse: boolean;
};

export function ResizablePanel({
  children,
  onCollapse,
  storageKey,
  defaultWidth = 256,
  fullWidth = false,
  side = 'start',
  minContentWidth = 320,
  resizeLabel,
  collapseLabel,
  testId,
}: {
  children: ReactNode;
  onCollapse?: () => void;
  storageKey: string;
  defaultWidth?: number;
  fullWidth?: boolean;
  side?: 'start' | 'end';
  minContentWidth?: number;
  resizeLabel: string;
  collapseLabel: string;
  testId: string;
}) {
  const widthAtom = useMemo(
    () => atomWithLocalStorage(storageKey, readWidth, setLocalStorageItem),
    [storageKey]
  );
  const [preferredWidth, setPreferredWidth] = useAtom(widthAtom);
  const [previewWidth, setPreviewWidth] = useState<number>();
  const [availableWidth, setAvailableWidth] = useState(MAX_WIDTH);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag>();
  const collapsePreview = !fullWidth && !!onCollapse && previewWidth === 0;
  const maxWidth = Math.max(
    Math.min(MIN_WIDTH, availableWidth),
    Math.min(MAX_WIDTH, availableWidth - minContentWidth)
  );
  const width = collapsePreview
    ? 0
    : clamp(previewWidth ?? preferredWidth ?? defaultWidth, maxWidth);
  const resizeDirection = () => {
    const inlineDirection =
      panelRef.current && getComputedStyle(panelRef.current).direction === 'rtl' ? -1 : 1;
    return side === 'end' ? -inlineDirection : inlineDirection;
  };

  useLayoutEffect(() => {
    if (fullWidth) {
      dragRef.current = undefined;
      setPreviewWidth(undefined);
      return undefined;
    }
    const parent = panelRef.current?.parentElement;
    if (!parent) return undefined;
    const measure = () => setAvailableWidth(parent.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [fullWidth]);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || dragRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      width,
      direction: resizeDirection(),
      collapse: false,
    };
  };
  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const requestedWidth = drag.startWidth + (event.clientX - drag.startX) * drag.direction;
    drag.collapse =
      !!onCollapse &&
      (drag.collapse
        ? requestedWidth < COLLAPSE_WIDTH + COLLAPSE_HYSTERESIS
        : requestedWidth <= COLLAPSE_WIDTH);
    drag.width = clamp(requestedWidth, maxWidth);
    setPreviewWidth(drag.collapse ? 0 : drag.width);
  };
  const finishResize = (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    setPreviewWidth(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (commit) {
      if (drag.collapse) onCollapse?.();
      else setPreferredWidth(Math.round(clamp(drag.width, maxWidth)));
    }
  };
  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number;
    switch (event.key) {
      case 'ArrowLeft':
        next = width - 20 * resizeDirection();
        break;
      case 'ArrowRight':
        next = width + 20 * resizeDirection();
        break;
      case 'Home':
        next = MIN_WIDTH;
        break;
      case 'End':
        next = maxWidth;
        break;
      case 'Enter':
        next = defaultWidth;
        break;
      default:
        return;
    }
    event.preventDefault();
    setPreferredWidth(Math.round(clamp(next, maxWidth)));
  };

  return (
    <div
      ref={panelRef}
      className={css.Panel}
      style={{ width: fullWidth ? '100%' : width }}
      data-testid={testId}
      data-side={side}
      data-collapse-preview={collapsePreview || undefined}
    >
      {children}
      {/* A focusable separator implements the adjustable splitter pattern. */}
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      {!fullWidth && (
        <div
          className={css.Handle}
          role="separator"
          aria-label={resizeLabel}
          aria-orientation="vertical"
          aria-valuemin={collapsePreview ? 0 : Math.min(MIN_WIDTH, maxWidth)}
          aria-valuemax={maxWidth}
          aria-valuenow={width}
          aria-valuetext={collapsePreview ? collapseLabel : undefined}
          tabIndex={0}
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={(event) => finishResize(event, true)}
          onPointerCancel={(event) => finishResize(event, false)}
          onLostPointerCapture={(event) => finishResize(event, false)}
          onKeyDown={resizeWithKeyboard}
        />
      )}
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
    </div>
  );
}
