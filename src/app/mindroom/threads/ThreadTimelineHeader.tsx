import React, { ReactNode, RefObject, useEffect, useRef } from 'react';
import { config } from 'folds';

/** Keep the banner in the scrollable content so messages can pass behind its glass. */
export function ThreadTimelineHeader({
  children,
  expansionControl,
  scrollRef,
}: {
  children: ReactNode;
  expansionControl: ReactNode;
  scrollRef: RefObject<HTMLDivElement>;
}) {
  const headerRef = useRef<HTMLDivElement>(null);

  // The scroll container is an ancestor; its ref attaches after child layout effects.
  useEffect(() => {
    const header = headerRef.current;
    const scroll = scrollRef.current;
    if (!header || !scroll) return undefined;
    const previousPadding = scroll.style.scrollPaddingTop;
    const updatePadding = () => {
      scroll.style.scrollPaddingTop = `${header.offsetHeight}px`;
    };
    updatePadding();
    const observer = new ResizeObserver(updatePadding);
    observer.observe(header);
    return () => {
      observer.disconnect();
      scroll.style.scrollPaddingTop = previousPadding;
    };
  }, [scrollRef]);

  return (
    <div
      ref={headerRef}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 3,
        flexShrink: 0,
        display: 'flow-root',
        paddingBottom: config.space.S600,
        pointerEvents: 'none',
      }}
    >
      {children}
      <div style={{ position: 'relative', pointerEvents: 'auto' }}>{expansionControl}</div>
    </div>
  );
}
