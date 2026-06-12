import React, { ReactNode, useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { Icon, Icons } from 'folds';
import * as css from './CollapsibleMessage.css';

const MAX_HEIGHT = '4.5em';

// Global expand/collapse event bus
type ExpandAllListener = (expand: boolean) => void;
const listeners = new Set<ExpandAllListener>();

// Virtualized timelines mount rows lazily, so an active expand/collapse-all must
// also apply to instances mounted after the broadcast. The latest broadcast is
// recorded here and consumed as the initial expanded state of new instances.
let currentExpandAllState: boolean | undefined;

export function expandAllMessages() {
  currentExpandAllState = true;
  listeners.forEach((fn) => fn(true));
}

export function collapseAllMessages() {
  currentExpandAllState = false;
  listeners.forEach((fn) => fn(false));
}

export function resetExpandAllState() {
  currentExpandAllState = undefined;
}

function useExpandAllListener(onToggle: (expand: boolean) => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return undefined;
    listeners.add(onToggle);
    return () => {
      listeners.delete(onToggle);
    };
  }, [enabled, onToggle]);
}

const getCollapsedMaxHeight = (el: HTMLDivElement): number | undefined => {
  if (MAX_HEIGHT.endsWith('px')) {
    const pixelHeight = Number.parseFloat(MAX_HEIGHT);
    return Number.isFinite(pixelHeight) ? pixelHeight : undefined;
  }

  if (!MAX_HEIGHT.endsWith('em') || typeof globalThis.getComputedStyle !== 'function') {
    return undefined;
  }

  const fontSize = Number.parseFloat(globalThis.getComputedStyle(el).fontSize);
  if (!Number.isFinite(fontSize)) return undefined;

  return Number.parseFloat(MAX_HEIGHT) * fontSize;
};

/**
 * Returns whether the element's content overflows the collapsed max-height.
 * Returns `null` when the element hasn't been laid out yet (scrollHeight === 0),
 * so callers can preserve their current assumption instead of recording a
 * false negative.
 */
const isContentOverflowing = (el: HTMLDivElement, expanded: boolean): boolean | null => {
  if (el.scrollHeight === 0) return null;

  const collapsedMaxHeight = getCollapsedMaxHeight(el);
  if (collapsedMaxHeight !== undefined) {
    return el.scrollHeight > collapsedMaxHeight + 1;
  }

  return !expanded && el.scrollHeight > el.clientHeight + 1;
};

export type CollapsibleMessageCollapseMode = 'default' | 'always-expanded' | 'initially-expanded';

type CollapsibleMessageProps = {
  children: ReactNode | ((state: CollapsibleMessageRenderState) => ReactNode);
  collapseMode?: CollapsibleMessageCollapseMode;
  forceOverflowing?: boolean;
  measurementKey?: string;
  onInitialExpandConsumed?: () => void;
};

export type CollapsibleMessageRenderState = {
  expanded: boolean;
};

export function CollapsibleMessage({
  children,
  collapseMode = 'default',
  forceOverflowing = false,
  measurementKey,
  onInitialExpandConsumed,
}: CollapsibleMessageProps) {
  const isExempt = collapseMode === 'always-expanded';
  const contentRef = useRef<HTMLDivElement>(null);
  const gradientRef = useRef<HTMLDivElement>(null);
  const initialExpandConsumedRef = useRef(onInitialExpandConsumed);
  const previousCollapseModeRef = useRef<CollapsibleMessageCollapseMode | undefined>(undefined);
  const needsFocusOnCollapseRef = useRef(false);
  const [overflowing, setOverflowing] = useState(true);
  const [expanded, setExpanded] = useState(() => {
    if (!isExempt && currentExpandAllState !== undefined) {
      return currentExpandAllState;
    }
    return collapseMode !== 'default';
  });

  initialExpandConsumedRef.current = onInitialExpandConsumed;

  const checkOverflow = useCallback(() => {
    if (isExempt) return;
    if (forceOverflowing) {
      setOverflowing(true);
      return;
    }
    const el = contentRef.current;
    if (!el) return;
    const result = isContentOverflowing(el, expanded);
    if (result !== null) {
      setOverflowing(result);
    }
  }, [expanded, forceOverflowing, isExempt]);

  useEffect(() => {
    if (
      collapseMode === 'initially-expanded' &&
      previousCollapseModeRef.current !== 'initially-expanded'
    ) {
      setExpanded(true);
      initialExpandConsumedRef.current?.();
    }
    previousCollapseModeRef.current = collapseMode;
  }, [collapseMode]);

  // Re-measure when the collapse state or the semantic message identity changes.
  useLayoutEffect(checkOverflow, [checkOverflow, measurementKey]);

  // ResizeObserver for async layout shifts (lazy images, font loading, etc.)
  useEffect(() => {
    const el = contentRef.current;
    if (isExempt || forceOverflowing || !el || expanded || typeof ResizeObserver === 'undefined')
      return undefined;
    const observer = new ResizeObserver(() => {
      const result = isContentOverflowing(el, expanded);
      if (result !== null) {
        setOverflowing(result);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, forceOverflowing, isExempt]);

  // IntersectionObserver: re-check overflow when element enters the viewport.
  // Catches elements that had zero scrollHeight when first measured off-screen.
  useEffect(() => {
    const el = contentRef.current;
    if (
      isExempt ||
      forceOverflowing ||
      !el ||
      expanded ||
      typeof IntersectionObserver === 'undefined'
    )
      return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          const result = isContentOverflowing(el, expanded);
          if (result !== null) {
            setOverflowing(result);
          }
        }
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, forceOverflowing, isExempt]);

  // Subscribe to global expand/collapse events
  const handleGlobalToggle = useCallback((expand: boolean) => {
    setExpanded(expand);
    if (!expand) {
      setOverflowing(false); // will be re-detected by useLayoutEffect
    }
  }, []);
  useExpandAllListener(handleGlobalToggle, !isExempt);

  // Focus management: after collapse, focus the gradient expand control
  useEffect(() => {
    if (needsFocusOnCollapseRef.current && !expanded && overflowing && gradientRef.current) {
      gradientRef.current.focus();
      needsFocusOnCollapseRef.current = false;
    }
  }, [expanded, overflowing]);

  const handleGradientClick = useCallback(() => {
    setExpanded(true);
  }, []);

  const handleGradientKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setExpanded(true);
    }
  }, []);

  const handleCollapseClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    needsFocusOnCollapseRef.current = true;
    setExpanded(false);
    setOverflowing(false);
  }, []);

  const handleCollapseKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      needsFocusOnCollapseRef.current = true;
      setExpanded(false);
      setOverflowing(false);
    }
  }, []);

  const showCloseButton = !isExempt && expanded && overflowing;
  const showGradient = !isExempt && !expanded && overflowing;
  const effectiveExpanded = isExempt || expanded;
  const renderedChildren =
    typeof children === 'function' ? children({ expanded: effectiveExpanded }) : children;

  return (
    <div>
      <div
        ref={contentRef}
        className={css.CollapsibleContent()}
        aria-expanded={isExempt ? undefined : expanded}
        style={{
          maxHeight: effectiveExpanded ? undefined : MAX_HEIGHT,
          overflow: effectiveExpanded ? undefined : 'hidden',
        }}
      >
        {renderedChildren}
        {showGradient && (
          <div
            ref={gradientRef}
            className={css.CollapsibleGradientOverlay}
            role="button"
            tabIndex={0}
            aria-label="Show more"
            onClick={handleGradientClick}
            onKeyDown={handleGradientKeyDown}
          >
            <span className={css.CollapsibleShowMore}>
              <Icon size="50" src={Icons.ChevronBottom} />
              <span>Show more</span>
            </span>
          </div>
        )}
        {showCloseButton && (
          <div className={css.CollapsibleStickyFooter}>
            <button
              type="button"
              className={css.CollapsiblePill}
              aria-label="Show less"
              title="Show less"
              onClick={handleCollapseClick}
              onKeyDown={handleCollapseKeyDown}
            >
              <Icon size="50" src={Icons.ChevronTop} />
              <span>Show less</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
