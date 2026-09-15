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
import { useMindroomDesktopPageNav } from './desktopPageNavState';

const MIN_WIDTH = 200;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 256;
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

export function ResizablePageNav({
  children,
  onCollapse,
}: {
  children: ReactNode;
  onCollapse?: () => void;
}) {
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
  const collapsePreview = !mobile && !!onCollapse && previewWidth === 0;
  const maxWidth = Math.max(0, Math.min(MAX_WIDTH, availableWidth - 320));
  const width = collapsePreview
    ? 0
    : clamp(previewWidth ?? preferredWidth ?? DEFAULT_WIDTH, maxWidth);
  const resizeDirection = () =>
    panelRef.current && getComputedStyle(panelRef.current).direction === 'rtl' ? -1 : 1;

  useLayoutEffect(() => {
    if (mobile) {
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
  }, [mobile]);

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
        next = DEFAULT_WIDTH;
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
      style={{ width: mobile ? '100%' : width }}
      data-testid="resizable-page-nav"
      data-collapse-preview={collapsePreview || undefined}
    >
      {children}
      {/* A focusable separator implements the adjustable splitter pattern. */}
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      {!mobile && (
        <div
          className={css.Handle}
          role="separator"
          aria-label={t('mindroomUi.sidebar.resizeNavigationPanel')}
          aria-orientation="vertical"
          aria-valuemin={collapsePreview ? 0 : Math.min(MIN_WIDTH, maxWidth)}
          aria-valuemax={maxWidth}
          aria-valuenow={width}
          aria-valuetext={
            collapsePreview ? t('sharedUi.mindroomNavigation.collapseNavigationPanel') : undefined
          }
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

export function MindroomPageNav({ path, children }: { path: string; children: ReactNode }) {
  const { canCollapse, setCollapsed } = useMindroomDesktopPageNav();
  return (
    <MobileFriendlyPageNav path={path}>
      <ResizablePageNav onCollapse={canCollapse ? () => setCollapsed(true) : undefined}>
        {children}
      </ResizablePageNav>
    </MobileFriendlyPageNav>
  );
}
