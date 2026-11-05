import { CSSProperties, ReactNode, RefObject, useEffect, useState } from 'react';
import classNames from 'classnames';
import * as css from './ScrollTopContainer.css';

type ScrollTopContainerProps = {
  /** The scrolling element to watch. */
  scrollRef: RefObject<HTMLElement>;
  /** Shown once the content is scrolled down by more than this many pixels. */
  threshold?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
};

/**
 * Shows its children (usually a "scroll to top" button) floating over the top of the scrolling
 * content, while that content is scrolled away from its start.
 */
export function ScrollTopContainer({
  scrollRef,
  threshold = 200,
  className,
  style,
  children,
}: ScrollTopContainerProps) {
  const [scrolledAway, setScrolledAway] = useState(false);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return undefined;
    const update = () => setScrolledAway(scroll.scrollTop > threshold);
    update();
    scroll.addEventListener('scroll', update, { passive: true });
    return () => scroll.removeEventListener('scroll', update);
  }, [scrollRef, threshold]);

  if (!scrolledAway) return null;
  return (
    <div className={classNames(css.ScrollTopContainer, className)} style={style}>
      {children}
    </div>
  );
}
