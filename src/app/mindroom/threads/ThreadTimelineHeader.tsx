import React, { ReactNode, RefObject, useEffect, useRef } from 'react';
import { config } from 'folds';
import { headerInset } from './RoomOverlay.css';

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
      scroll.style.scrollPaddingTop = `calc(${headerInset} + ${header.offsetHeight}px)`;
      scroll.parentElement?.style.setProperty(
        '--room-thread-header-height',
        `${header.offsetHeight}px`
      );
    };
    updatePadding();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      // The inset resizes the shallower scrollbar track. Write next frame so
      // its observer can run without violating ResizeObserver's depth ordering.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updatePadding();
      });
    });
    observer.observe(header);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      scroll.style.scrollPaddingTop = previousPadding;
      scroll.parentElement?.style.removeProperty('--room-thread-header-height');
    };
  }, [scrollRef]);

  return (
    <div
      ref={headerRef}
      style={{
        position: 'sticky',
        top: headerInset,
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
