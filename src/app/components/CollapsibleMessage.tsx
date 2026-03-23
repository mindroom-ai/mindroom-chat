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

function useExpandAllListener(onToggle: (expand: boolean) => void) {
  useEffect(() => {
    listeners.add(onToggle);
    return () => { listeners.delete(onToggle); };
  }, [onToggle]);
}

type CollapsibleMessageProps = {
  children: ReactNode;
};

export function CollapsibleMessage({ children }: CollapsibleMessageProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const checkOverflow = () => {
    const el = contentRef.current;
    if (el && !expanded) {
      setOverflowing(el.scrollHeight > el.clientHeight + 1);
    }
  };

  // Runs synchronously after every render — catches streaming edits
  useLayoutEffect(checkOverflow);

  // ResizeObserver for async layout shifts (lazy images, font loading, etc.)
  useEffect(() => {
    const el = contentRef.current;
    if (!el || expanded) return undefined;
    const observer = new ResizeObserver(() => {
      if (el.scrollHeight > el.clientHeight + 1) {
        setOverflowing(true);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded]);

  // Subscribe to global expand/collapse events
  const handleGlobalToggle = useCallback((expand: boolean) => {
    setExpanded(expand);
    if (!expand) {
      setOverflowing(false); // will be re-detected by useLayoutEffect
    }
  }, []);
  useExpandAllListener(handleGlobalToggle);

  return (
    <div style={{ overflowAnchor: 'none' }}>
      <div
        ref={contentRef}
        style={{
          maxHeight: expanded ? undefined : MAX_HEIGHT,
          overflow: expanded ? undefined : 'hidden',
          position: 'relative',
        }}
      >
        {children}
        {!expanded && overflowing && (
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
      {(overflowing || expanded) && (
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
