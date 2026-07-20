import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Icon, Icons, Text } from 'folds';
import * as css from './recentThreads.css';

type RecentThreadsResizeProps = {
  mode: 'resize';
  panelHeight: number;
  minHeight: number;
  maxHeight: number;
  collapsedHeight: number;
  onPreviewHeightChange: (height: number) => void;
  onCommitHeightChange: (height: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
  entryCount?: never;
  isExpanded?: boolean;
  onToggle?: never;
};

type RecentThreadsToggleProps = {
  entryCount: number;
  mode: 'toggle';
  isExpanded: boolean;
  onToggle: () => void;
  panelHeight?: never;
  minHeight?: never;
  maxHeight?: never;
  collapsedHeight?: never;
  onPreviewHeightChange?: never;
  onCommitHeightChange?: never;
  onDraggingChange?: never;
};

type RecentThreadsDividerProps = RecentThreadsResizeProps | RecentThreadsToggleProps;

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

export function RecentThreadsDivider(props: RecentThreadsDividerProps) {
  const { t } = useTranslation();
  const { mode } = props;
  const resizeProps = mode === 'resize' ? props : undefined;
  const toggleProps = mode === 'toggle' ? props : undefined;
  const countLabel =
    toggleProps && toggleProps.entryCount > 0 ? `${toggleProps.entryCount}` : undefined;
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<DragState | undefined>(undefined);
  const resizePropsRef = useRef(resizeProps);
  const onDraggingChangeRef = useRef(resizeProps?.onDraggingChange);

  useLayoutEffect(() => {
    resizePropsRef.current = resizeProps;
    if (resizeProps) {
      onDraggingChangeRef.current = resizeProps.onDraggingChange;
    }
  }, [resizeProps]);

  useEffect(() => {
    onDraggingChangeRef.current?.(dragging);
  }, [dragging]);

  useEffect(
    () => () => {
      if (!dragStateRef.current) return;

      dragStateRef.current = undefined;
      onDraggingChangeRef.current?.(false);
    },
    []
  );

  const commitResolvedHeight = useCallback(
    (nextHeight: number) => {
      if (!resizeProps) return;

      const resolvedHeight = getResolvedHeight(
        nextHeight,
        resizeProps.minHeight,
        resizeProps.maxHeight,
        resizeProps.collapsedHeight
      );
      resizeProps.onPreviewHeightChange(resolvedHeight);
      resizeProps.onCommitHeightChange(resolvedHeight);
    },
    [resizeProps]
  );

  useEffect(() => {
    if (!dragging) return undefined;

    const handlePointerMove = (evt: PointerEvent) => {
      const dragState = dragStateRef.current;
      const currentResizeProps = resizePropsRef.current;
      if (!dragState || evt.pointerId !== dragState.pointerId || !currentResizeProps) return;

      const deltaY = evt.clientY - dragState.startY;
      const nextHeight = getResolvedHeight(
        dragState.startHeight - deltaY,
        currentResizeProps.minHeight,
        currentResizeProps.maxHeight,
        currentResizeProps.collapsedHeight
      );

      dragState.lastHeight = nextHeight;
      currentResizeProps.onPreviewHeightChange(nextHeight);
    };

    const finishDrag = (pointerId: number, commit: boolean) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== pointerId) return;

      dragStateRef.current = undefined;
      setDragging(false);

      const currentResizeProps = resizePropsRef.current;
      if (!currentResizeProps) return;

      if (commit) {
        const committedHeight = getResolvedHeight(
          dragState.lastHeight,
          currentResizeProps.minHeight,
          currentResizeProps.maxHeight,
          currentResizeProps.collapsedHeight
        );
        currentResizeProps.onPreviewHeightChange(committedHeight);
        currentResizeProps.onCommitHeightChange(committedHeight);
        return;
      }

      currentResizeProps.onPreviewHeightChange(
        getResolvedHeight(
          dragState.startHeight,
          currentResizeProps.minHeight,
          currentResizeProps.maxHeight,
          currentResizeProps.collapsedHeight
        )
      );
    };

    const handlePointerUp = (evt: PointerEvent) => {
      finishDrag(evt.pointerId, true);
    };

    const handlePointerCancel = (evt: PointerEvent) => {
      finishDrag(evt.pointerId, false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [dragging]);

  useEffect(() => {
    if (!resizeProps && dragging) {
      dragStateRef.current = undefined;
      setDragging(false);
    }
  }, [dragging, resizeProps]);

  const handlePointerDown = (evt: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeProps) return;

    evt.preventDefault();

    dragStateRef.current = {
      pointerId: evt.pointerId,
      startY: evt.clientY,
      startHeight: resizeProps.panelHeight,
      lastHeight: resizeProps.panelHeight,
    };
    setDragging(true);
  };

  const handleResizeKeyDown = (evt: React.KeyboardEvent<HTMLDivElement>) => {
    if (!resizeProps || (evt.key !== 'ArrowUp' && evt.key !== 'ArrowDown')) return;

    evt.preventDefault();

    if (evt.key === 'ArrowUp') {
      const nextHeight =
        resizeProps.panelHeight <= resizeProps.collapsedHeight
          ? resizeProps.minHeight
          : resizeProps.panelHeight + KEYBOARD_RESIZE_STEP;
      commitResolvedHeight(nextHeight);
      return;
    }

    const nextHeight =
      resizeProps.panelHeight <= resizeProps.collapsedHeight ||
      resizeProps.panelHeight - KEYBOARD_RESIZE_STEP < resizeProps.minHeight
        ? resizeProps.collapsedHeight
        : resizeProps.panelHeight - KEYBOARD_RESIZE_STEP;
    commitResolvedHeight(nextHeight);
  };

  return (
    <>
      {toggleProps ? (
        <button
          type="button"
          aria-label={t('recentThreads.title')}
          aria-expanded={toggleProps.isExpanded}
          className={css.DividerToggle}
          onClick={toggleProps.onToggle}
        >
          <Box as="span" alignItems="Center" gap="200" style={{ minWidth: 0 }}>
            <span
              className={`${css.DividerHandle} ${css.DividerToggleHandle}`}
              aria-hidden="true"
            />
            <Text as="span" size="T200" priority="300" role="heading" aria-level={2}>
              {t('recentThreads.title')}
            </Text>
          </Box>
          <Box as="span" alignItems="Center" gap="100" style={{ flexShrink: 0 }}>
            {countLabel && (
              <Text as="span" size="T200" priority="400" aria-hidden="true">
                {countLabel}
              </Text>
            )}
            <Icon
              size="50"
              src={toggleProps.isExpanded ? Icons.ChevronTop : Icons.ChevronBottom}
              aria-hidden="true"
            />
          </Box>
        </button>
      ) : (
        <>
          {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
          <div
            role="separator"
            aria-label={t('recentThreads.resizeAria')}
            aria-orientation="horizontal"
            aria-valuemin={resizeProps?.collapsedHeight}
            aria-valuemax={resizeProps?.maxHeight}
            aria-valuenow={resizeProps?.panelHeight}
            tabIndex={0}
            className={`${css.Divider}${dragging ? ` ${css.DividerActive}` : ''}`}
            onKeyDown={handleResizeKeyDown}
            onPointerDown={handlePointerDown}
          >
            <span className={css.DividerHandle} />
          </div>
          {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        </>
      )}
    </>
  );
}
