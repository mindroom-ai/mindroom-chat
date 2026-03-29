import React, { ReactNode, useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { Icon, Icons } from 'folds';
import * as css from './CollapsibleMessage.css';

const MAX_HEIGHT = '4.5em';

// Global expand/collapse event bus
type ExpandAllListener = (expand: boolean) => void;
const listeners = new Set<ExpandAllListener>();

export function expandAllMessages() {
  listeners.forEach((fn) => fn(true));
}

export function collapseAllMessages() {
  listeners.forEach((fn) => fn(false));
}

function useExpandAllListener(onToggle: (expand: boolean) => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return undefined;
    listeners.add(onToggle);
    return () => { listeners.delete(onToggle); };
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

export type CollapsibleMessageCollapseMode =
  | 'default'
  | 'always-expanded'
  | 'initially-expanded';

type CollapsibleMessageProps = {
  children: ReactNode;
  collapseMode?: CollapsibleMessageCollapseMode;
  onInitialExpandConsumed?: () => void;
};

export function CollapsibleMessage({
  children,
  collapseMode = 'default',
  onInitialExpandConsumed,
}: CollapsibleMessageProps) {
  const isExempt = collapseMode === 'always-expanded';
  const contentRef = useRef<HTMLDivElement>(null);
  const gradientRef = useRef<HTMLDivElement>(null);
  const initialExpandConsumedRef = useRef(onInitialExpandConsumed);
  const previousCollapseModeRef = useRef<CollapsibleMessageCollapseMode | undefined>(undefined);
  const needsFocusOnCollapseRef = useRef(false);
  const [overflowing, setOverflowing] = useState(true);
  const [expanded, setExpanded] = useState(() => collapseMode !== 'default');

  initialExpandConsumedRef.current = onInitialExpandConsumed;

  const checkOverflow = useCallback(() => {
    if (isExempt) return;
    const el = contentRef.current;
    if (!el) return;
    const result = isContentOverflowing(el, expanded);
    if (result !== null) {
      setOverflowing(result);
    }
  }, [expanded, isExempt]);

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

  // Runs synchronously after every render — catches streaming edits
  useLayoutEffect(checkOverflow);

  // ResizeObserver for async layout shifts (lazy images, font loading, etc.)
  useEffect(() => {
    const el = contentRef.current;
    if (isExempt || !el || expanded || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      const result = isContentOverflowing(el, expanded);
      if (result !== null) {
        setOverflowing(result);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, isExempt]);

  // IntersectionObserver: re-check overflow when element enters the viewport.
  // Catches elements that had zero scrollHeight when first measured off-screen.
  useEffect(() => {
    const el = contentRef.current;
    if (isExempt || !el || expanded || typeof IntersectionObserver === 'undefined') return undefined;
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
  }, [expanded, isExempt]);

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

  return (
    <div style={{ overflowAnchor: 'none' }}>
      <div
        ref={contentRef}
        className={css.CollapsibleContent()}
        aria-expanded={isExempt ? undefined : expanded}
        style={{
          maxHeight: isExempt || expanded ? undefined : MAX_HEIGHT,
          overflow: isExempt || expanded ? undefined : 'hidden',
          paddingRight: showCloseButton ? '2rem' : undefined,
        }}
      >
        {children}
        {showGradient && (
          <div
            ref={gradientRef}
            className={css.CollapsibleGradientOverlay}
            role="button"
            tabIndex={0}
            aria-label="Expand message"
            onClick={handleGradientClick}
            onKeyDown={handleGradientKeyDown}
          >
            <span className={css.CollapsibleShowMore}>Show more</span>
          </div>
        )}
        {showCloseButton && (
          <button
            type="button"
            className={css.CollapsibleCloseButton}
            aria-label="Collapse message"
            title="Collapse message"
            onClick={handleCollapseClick}
            onKeyDown={handleCollapseKeyDown}
          >
            <Icon size="50" src={Icons.ChevronTop} />
          </button>
        )}
      </div>
    </div>
  );
}
