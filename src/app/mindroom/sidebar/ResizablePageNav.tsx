import { useTranslation } from 'react-i18next';
import React, { ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { MobileFriendlyPageNav } from '../../pages/MobileFriendly';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../state/utils/atomWithLocalStorage';
import * as css from './ResizablePageNav.css';

const MIN_WIDTH = 200;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 256;
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
};

export function ResizablePageNav({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const userId = useMatrixClient().getSafeUserId();
  const widthAtom = useMemo(
    () => atomWithLocalStorage(`mindroom.pageNav.width:${userId}`, readWidth, setLocalStorageItem),
    [userId]
  );
  const [preferredWidth, setPreferredWidth] = useAtom(widthAtom);
  const [previewWidth, setPreviewWidth] = useState<number>();
  const [availableWidth, setAvailableWidth] = useState(MAX_WIDTH);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag>();
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const maxWidth = Math.max(0, Math.min(MAX_WIDTH, availableWidth - (mobile ? 16 : 320)));
  const defaultWidth = mobile ? maxWidth : DEFAULT_WIDTH;
  const width = clamp(previewWidth ?? preferredWidth ?? defaultWidth, maxWidth);
  const resizeDirection = () =>
    panelRef.current && getComputedStyle(panelRef.current).direction === 'rtl' ? -1 : 1;

  useLayoutEffect(() => {
    const parent = panelRef.current?.parentElement;
    if (!parent) return undefined;
    const measure = () => setAvailableWidth(parent.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

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
    };
  };
  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.width = clamp(drag.startWidth + (event.clientX - drag.startX) * drag.direction, maxWidth);
    setPreviewWidth(drag.width);
  };
  const finishResize = (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    setPreviewWidth(undefined);
    if (commit) setPreferredWidth(Math.round(clamp(drag.width, maxWidth)));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
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
    <div ref={panelRef} className={css.Panel} style={{ width }} data-testid="resizable-page-nav">
      {children}
      {/* A focusable separator implements the adjustable splitter pattern. */}
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div
        className={css.Handle}
        role="separator"
        aria-label={t('mindroomUi.sidebar.resizeNavigationPanel')}
        aria-orientation="vertical"
        aria-valuemin={Math.min(MIN_WIDTH, maxWidth)}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={(event) => finishResize(event, true)}
        onPointerCancel={(event) => finishResize(event, false)}
        onLostPointerCapture={(event) => finishResize(event, false)}
        onKeyDown={resizeWithKeyboard}
      />
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
    </div>
  );
}

export function MindroomPageNav({ path, children }: { path: string; children: ReactNode }) {
  return (
    <MobileFriendlyPageNav path={path}>
      <ResizablePageNav>{children}</ResizablePageNav>
    </MobileFriendlyPageNav>
  );
}
