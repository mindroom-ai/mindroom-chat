import React, { HTMLAttributes, ReactNode, RefObject, useRef } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { ScrollHeaderProvider } from '../glass/SurfaceContext';
import { InsetScrollbar } from '../inset-scrollbar/InsetScrollbar';
import { Viewport } from '../inset-scrollbar/InsetScrollbar.css';
import * as css from './PageScroll.css';

type PageScrollProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  /** Stays put above the scrolling content. */
  header?: ReactNode;
  children?: ReactNode;
  scrollRef?: RefObject<HTMLDivElement>;
  /** Composite widgets inside (listboxes) keep the arrow keys, so their scrollbar is skipped. */
  scrollbarTabIndex?: 0 | -1;
  scrollbarLabel?: string;
};

/** A header over native scrolling content with an inset scrollbar. */
export function PageScroll({
  header,
  children,
  scrollRef,
  scrollbarTabIndex = 0,
  scrollbarLabel,
  className,
  ...props
}: PageScrollProps) {
  const { t } = useTranslation();
  const ownScrollRef = useRef<HTMLDivElement>(null);
  const viewportRef = scrollRef ?? ownScrollRef;
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <div className={classNames(css.PageScroll, className)} {...props}>
      {header && <ScrollHeaderProvider value>{header}</ScrollHeaderProvider>}
      <div className={css.PageScrollBody}>
        <div ref={viewportRef} className={classNames(Viewport, css.PageScrollViewport)}>
          <div ref={contentRef}>{children}</div>
        </div>
        <InsetScrollbar
          scrollRef={viewportRef}
          contentRef={contentRef}
          label={scrollbarLabel ?? t('sharedUi.pageScroll.scrollbar')}
          className={css.PageScrollbar}
          tabIndex={scrollbarTabIndex}
        />
      </div>
    </div>
  );
}
