import React, { CSSProperties, ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../lib/state/atomWithLocalStorage';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import {
  animatePanel,
  currentPanelSize,
  panelGap,
  type PanelPhase,
  usePanelPresence,
} from './panelPresence';
import * as css from './ResizablePanel.css';

const MIN_WIDTH = 200;
const MAX_WIDTH = 600;
const COLLAPSE_WIDTH = MIN_WIDTH - 40;
/** The conversation column keeps at least this much room beside a resizable side panel. */
export const CONVERSATION_MIN_WIDTH = 360;
const clamp = (width: number, max: number) =>
  Math.min(Math.max(Math.min(MIN_WIDTH, max), width), max);
const readWidth = (key: string, max: number): number | undefined => {
  const value = getLocalStorageItem<unknown>(key, undefined);
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? clamp(value, max)
    : undefined;
};

type Drag = {
  pointerId: number;
  startX: number;
  startWidth: number;
  width: number;
  direction: number;
};

export function ResizablePanel({
  children,
  onCollapse,
  storageKey,
  defaultWidth = 256,
  fullWidth = false,
  passthrough = false,
  side = 'start',
  minContentWidth = 320,
  maxPanelWidth = MAX_WIDTH,
  resizeLabel,
  collapseLabel,
  testId,
  overlay,
}: {
  children: ReactNode;
  onCollapse?: () => void;
  storageKey: string;
  defaultWidth?: number;
  fullWidth?: boolean;
  /** Render no box of its own, for a child that positions itself (such as a full-screen phone panel). */
  passthrough?: boolean;
  side?: 'start' | 'end';
  minContentWidth?: number;
  /** The widest the panel may be dragged; the content beside it keeps minContentWidth. */
  maxPanelWidth?: number;
  resizeLabel: string;
  collapseLabel: string;
  testId: string;
  /**
   * Rendered over the panel after its content, for a child placed against the panel's box; the
   * content's width is `--mr-panel-content-width` there too.
   */
  overlay?: ReactNode;
}) {
  const widthAtom = useMemo(
    () =>
      atomWithLocalStorage(storageKey, (key) => readWidth(key, maxPanelWidth), setLocalStorageItem),
    [storageKey, maxPanelWidth]
  );
  const [preferredWidth, setPreferredWidth] = useAtom(widthAtom);
  const [previewWidth, setPreviewWidth] = useState<number>();
  const [availableWidth, setAvailableWidth] = useState(maxPanelWidth);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag>();
  const presence = usePanelPresence();
  const phase = presence?.phase ?? 'shown';
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  // Beside the content a panel opens and closes by moving its width; phones and full-width
  // panels switch at once.
  const moves = !fullWidth && !passthrough && !mobile;
  const motionRef = useRef<Animation>();
  const phaseSeen = useRef<PanelPhase>('shown');
  /** The width a released drag left on screen, which the next commit moves from. */
  const releasedAt = useRef<number>();
  const movesRef = useRef(moves);
  const maxWidth = Math.max(
    Math.min(MIN_WIDTH, availableWidth),
    Math.min(maxPanelWidth, availableWidth - minContentWidth)
  );
  const minWidth = Math.min(MIN_WIDTH, maxWidth);
  const settledWidth = clamp(preferredWidth ?? defaultWidth, maxWidth);
  const width =
    previewWidth === undefined || fullWidth ? settledWidth : Math.min(previewWidth, maxWidth);
  // Narrower than its smallest width (a drag on its way to closing it), the panel clips its
  // content instead of squeezing it.
  const contentWidth = Math.max(width, minWidth);
  const collapseOnRelease =
    !fullWidth && !!onCollapse && previewWidth !== undefined && width <= COLLAPSE_WIDTH;
  const resizeDirection = () => {
    const inlineDirection =
      panelRef.current && getComputedStyle(panelRef.current).direction === 'rtl' ? -1 : 1;
    return side === 'end' ? -inlineDirection : inlineDirection;
  };

  // Open, close or swap places in motion when the slot's phase changes.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (phase === phaseSeen.current) return;
    phaseSeen.current = phase;
    if (!moves || !panel) {
      if (phase === 'exit') presence?.done();
      return;
    }
    // Turned around mid-motion, a panel moves on from where it is.
    const now = motionRef.current?.playState === 'running' ? currentPanelSize(panel) : undefined;
    motionRef.current?.cancel();
    const gap = panelGap(panel, side);
    if (phase === 'exit') {
      // A drag released past the threshold left the panel at its width; it closes from there.
      const motion = animatePanel(panel, now ?? { width, gap: 0 }, { width: 0, gap }, true);
      motionRef.current = motion;
      if (motion) void motion.finished.then(presence?.done, () => undefined);
      else presence?.done();
      return;
    }
    if (previewWidth !== undefined) setPreviewWidth(undefined);
    let from = now ?? { width: 0, gap };
    if (phase === 'swap') from = { width: presence?.lastWidth.current ?? settledWidth, gap: 0 };
    motionRef.current = animatePanel(panel, from, { width: settledWidth, gap: 0 }, false);
  }, [moves, phase, presence, previewWidth, settledWidth, side, width]);

  // A drag released above the threshold moves on from where it let go to the width it settled on.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const released = releasedAt.current;
    releasedAt.current = undefined;
    movesRef.current = moves;
    if (panel && released !== undefined && moves && released !== width) {
      motionRef.current?.cancel();
      const from = { width: released, gap: 0 };
      motionRef.current = animatePanel(panel, from, { width, gap: 0 }, false);
    }
  });

  // The slot waits for this panel to close; a panel that takes another's place starts from the
  // width that one had when it left.
  const register = presence?.register;
  const lastWidth = presence?.lastWidth;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const unregister = register?.();
    return () => {
      unregister?.();
      if (lastWidth && panel) {
        lastWidth.current = movesRef.current ? panel.getBoundingClientRect().width : undefined;
      }
    };
  }, [lastWidth, register]);

  useLayoutEffect(() => {
    if (fullWidth || passthrough) {
      dragRef.current = undefined;
      setPreviewWidth(undefined);
      return undefined;
    }
    const parent = panelRef.current?.parentElement;
    if (!parent) return undefined;
    const measure = () => {
      const style = getComputedStyle(parent);
      const padding =
        (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      // Room beyond the widest panel and the content beside it changes nothing, so a row that
      // grows or shrinks around a wide-enough panel (another panel moving) does not render it.
      const usable = Math.max(0, parent.clientWidth - padding);
      setAvailableWidth(Math.min(usable, maxPanelWidth + minContentWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [fullWidth, passthrough, maxPanelWidth, minContentWidth]);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || dragRef.current || phase === 'exit') return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // Caught mid-motion, the drag starts from where the panel is on screen.
    const panel = panelRef.current;
    const startWidth =
      panel && motionRef.current?.playState === 'running'
        ? panel.getBoundingClientRect().width
        : width;
    motionRef.current?.cancel();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth,
      width: startWidth,
      direction: resizeDirection(),
    };
  };
  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const requestedWidth = drag.startWidth + (event.clientX - drag.startX) * drag.direction;
    // A panel that can close follows the pointer all the way to nothing; others stop at their
    // smallest width.
    drag.width = onCollapse
      ? Math.max(0, Math.min(requestedWidth, maxWidth))
      : clamp(requestedWidth, maxWidth);
    setPreviewWidth(drag.width);
  };
  const finishResize = (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (commit && onCollapse && drag.width <= COLLAPSE_WIDTH) {
      // The panel stays where the drag let go while its owner closes it, which moves it the
      // rest of the way out.
      onCollapse();
      return;
    }
    setPreviewWidth(undefined);
    releasedAt.current = drag.width;
    if (commit) setPreferredWidth(Math.round(clamp(drag.width, maxWidth)));
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

  let contentStyle: CSSProperties | undefined;
  if (passthrough) contentStyle = { display: 'contents' };
  else if (!fullWidth) {
    contentStyle = { ['--mr-panel-content-width' as string]: `${contentWidth}px` };
  }

  return (
    <div
      ref={panelRef}
      className={css.Panel}
      style={passthrough ? { display: 'contents' } : { width: fullWidth ? '100%' : width }}
      data-testid={testId}
      data-side={side}
      data-collapse-preview={collapseOnRelease || undefined}
    >
      <div style={contentStyle}>{children}</div>
      {/* A focusable separator implements the adjustable splitter pattern. */}
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      {!fullWidth && !passthrough && (
        <div
          className={css.Handle}
          role="separator"
          aria-label={resizeLabel}
          aria-orientation="vertical"
          aria-valuemin={width < minWidth ? 0 : minWidth}
          aria-valuemax={maxWidth}
          aria-valuenow={Math.round(width)}
          aria-valuetext={collapseOnRelease ? collapseLabel : undefined}
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
      {overlay && <div style={{ ...contentStyle, display: 'contents' }}>{overlay}</div>}
    </div>
  );
}
