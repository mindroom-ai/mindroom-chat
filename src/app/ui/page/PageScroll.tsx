import { HTMLAttributes, ReactNode, RefObject, useLayoutEffect, useRef } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { ScrollHeaderProvider } from '../glass/SurfaceContext';
import { InsetScrollbar } from '../InsetScrollbar';
import { Viewport } from '../InsetScrollbar.css';
import { SCROLL_HEADER_HEIGHT_PROPERTY } from './scrollHeaderInset';
import * as css from './style.css';

type PageScrollProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  /** Stays at the top while the content scrolls beneath it. */
  header?: ReactNode;
  children?: ReactNode;
  scrollRef?: RefObject<HTMLDivElement>;
  /** Composite widgets inside (listboxes) keep the arrow keys, so their scrollbar is skipped. */
  scrollbarTabIndex?: 0 | -1;
  scrollbarLabel?: string;
  /** Lays out the content box, which fills the viewport under the title when it is short. */
  contentClassName?: string;
  /** Moves the scrollbar track, such as clear of a splitter at the edge. */
  scrollbarClassName?: string;
};

/**
 * Publishes the height of a sticky title as `--page-scroll-header-height` on `frame`, where the
 * scrollbar track and the viewport's scroll padding read it.
 */
export const useStickyHeaderInset = (
  frameRef: RefObject<HTMLElement>,
  headerRef: RefObject<HTMLElement>,
  hasHeader: boolean
) => {
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const header = headerRef.current;
    if (!frame) return undefined;
    if (!header || !hasHeader) return undefined;
    const publish = () => {
      frame.style.setProperty(SCROLL_HEADER_HEIGHT_PROPERTY, `${header.offsetHeight}px`);
    };
    publish();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => {
      observer.disconnect();
      frame.style.removeProperty(SCROLL_HEADER_HEIGHT_PROPERTY);
    };
  }, [frameRef, headerRef, hasHeader]);
};

/**
 * A title over native scrolling content. The title is sticky inside the scroll viewport, so the
 * content passes beneath its glass, and the inset scrollbar runs from under the title to the
 * bottom edge.
 */
export function PageScroll({
  header,
  children,
  scrollRef,
  scrollbarTabIndex = 0,
  scrollbarLabel,
  contentClassName,
  scrollbarClassName,
  className,
  ...props
}: PageScrollProps) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLDivElement>(null);
  const ownScrollRef = useRef<HTMLDivElement>(null);
  const viewportRef = scrollRef ?? ownScrollRef;
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useStickyHeaderInset(frameRef, headerRef, !!header);

  return (
    <div ref={frameRef} className={classNames(css.PageScroll, className)} {...props}>
      <div
        ref={viewportRef}
        className={classNames(Viewport, css.PageScrollViewport)}
        data-y-scrollbar-width={0}
      >
        {header && (
          <div ref={headerRef} className={css.PageScrollHeader}>
            <ScrollHeaderProvider value>{header}</ScrollHeaderProvider>
          </div>
        )}
        <div ref={contentRef} className={classNames(css.PageScrollContent, contentClassName)}>
          {children}
        </div>
        {/* Inside the viewport for its accessibility tree, placed by the frame so it stays put. */}
        <InsetScrollbar
          scrollRef={viewportRef}
          contentRef={contentRef}
          label={scrollbarLabel ?? t('sharedUi.pageScroll.scrollbar')}
          className={classNames(css.PageScrollbar, scrollbarClassName)}
          tabIndex={scrollbarTabIndex}
        />
      </div>
    </div>
  );
}
