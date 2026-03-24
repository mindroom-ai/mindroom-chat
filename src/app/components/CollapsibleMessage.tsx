import React, { ReactNode, useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { color } from 'folds';

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

const isContentOverflowing = (el: HTMLDivElement, expanded: boolean): boolean => {
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
  const initialExpandConsumedRef = useRef(onInitialExpandConsumed);
  const previousCollapseModeRef = useRef<CollapsibleMessageCollapseMode | undefined>(undefined);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(() => collapseMode !== 'default');

  initialExpandConsumedRef.current = onInitialExpandConsumed;

  const checkOverflow = useCallback(() => {
    if (isExempt) return;
    const el = contentRef.current;
    if (!el) return;
    setOverflowing(isContentOverflowing(el, expanded));
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
      setOverflowing(isContentOverflowing(el, expanded));
    });
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

  return (
    <div style={{ overflowAnchor: 'none' }}>
      <div
        ref={contentRef}
        style={{
          maxHeight: isExempt || expanded ? undefined : MAX_HEIGHT,
          overflow: isExempt || expanded ? undefined : 'hidden',
          position: 'relative',
        }}
      >
        {children}
        {!isExempt && !expanded && overflowing && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '1.5em',
              background: `linear-gradient(transparent, ${color.Surface.Container})`,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
      {!isExempt && overflowing && (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setExpanded((prev) => !prev);
            if (expanded) {
              // Collapsing — overflow will be re-detected by useLayoutEffect on next render
              setOverflowing(false);
            }
          }}
          style={{
            color: color.Primary.Main,
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontFamily: 'monospace',
          }}
        >
          {expanded ? '[-]' : '[+]'}
        </a>
      )}
    </div>
  );
}
