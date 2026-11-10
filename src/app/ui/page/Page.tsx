import { ComponentProps, ReactNode, RefObject } from 'react';
import classNames from 'classnames';
import { Box, Line, Text, as, color, config } from 'folds';
import { Header } from '../glass/GlassPrimitives';
import { useSurfaceContext } from '../glass/SurfaceContext';
import { inheritSurface } from '../glass/Surface.css';
import { ContainerColor } from '../styles/ContainerColor.css';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { PageScroll } from './PageScroll';
import * as css from './style.css';
import { PageDivider, PageSurface } from './floatingCards.css';

const NAV_HEADER_OUTLINE = `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`;

type PageRootProps = {
  nav: ReactNode;
  children: ReactNode;
  /** The page is the client's main content, so it becomes the `main` landmark. */
  main?: boolean;
};

/** Inside a glass surface (the settings dialog) pages reveal the material behind them. */
const useInheritSurfaceClass = () => (useSurfaceContext() ? inheritSurface : undefined);

// `display: contents` keeps the landmark out of the flex layout around it.
const PAGE_MAIN_STYLE = { display: 'contents' } as const;
/** The `main` landmark's ID, the skip link's target; one page shows at a time. */
export const PAGE_MAIN_ID = 'main-content';

/**
 * The `main` landmark around a page of the client, which the skip link and landmark navigation
 * of assistive technology go to. It takes no box of its own.
 */
export function PageMain({ children }: { children: ReactNode }) {
  return (
    <main id={PAGE_MAIN_ID} data-page-main style={PAGE_MAIN_STYLE}>
      {children}
    </main>
  );
}

/** Page layout: optional navigation column, a divider, then the page itself. */
export function PageRoot({ nav, children, main }: PageRootProps) {
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const surfaceClass = useInheritSurfaceClass();
  // On mobile the navigation is in a drawer over the page, so nothing divides them.
  const divider =
    nav && !mobile ? (
      <Line className={PageDivider} direction="Vertical" size="300" variant="Background" />
    ) : null;

  return (
    <Box className={classNames(ContainerColor({ variant: 'Background' }), surfaceClass)} grow="Yes">
      {nav}
      {divider}
      {main ? <PageMain>{children}</PageMain> : children}
    </Box>
  );
}

type PageNavProps = {
  size?: '400' | '300';
  /** Names the `nav` landmark, usually the column's title (Home, Activity, Settings). */
  label?: string;
  children: ReactNode;
};

/** The navigation column; on mobile it takes the whole width instead of a fixed size. */
export function PageNav({ size, label, children }: PageNavProps) {
  const isMobile = useScreenSizeContext() === ScreenSize.Mobile;
  const columnClass = classNames(
    css.PageNav(isMobile ? undefined : { size }),
    size === '300' && css.PageNavDense
  );

  return (
    <Box
      as="nav"
      aria-label={label}
      direction="Column"
      className={columnClass}
      grow={isMobile ? 'Yes' : undefined}
    >
      {children}
    </Box>
  );
}

/**
 * The title bar of a navigation column: flat frosted chrome, also inside a glass dialog, where it
 * only blurs what passes beneath it. `scroll` keeps it pinned when it sits in the scrolling list
 * itself; `outlined` draws a line under it (the reference screens have none by default).
 */
export const PageNavHeader = as<'header', { outlined?: boolean; scroll?: boolean }>(
  ({ scroll, outlined, className, style, ...props }, ref) => (
    <Header
      as="header"
      variant="Background"
      size="600"
      flat
      {...props}
      ref={ref}
      style={outlined ? { ...style, borderBottom: NAV_HEADER_OUTLINE } : style}
      className={classNames(css.PageNavHeader, scroll && css.PageNavHeaderScroll, className)}
    />
  )
);

type PageNavContentProps = {
  scrollRef?: RefObject<HTMLDivElement>;
  /** The column's title (a `PageNavHeader`), which the list scrolls beneath. */
  header?: ReactNode;
  /** Adds to the list's own padding, such as the settings menu's even inset. */
  className?: string;
  children: ReactNode;
};

/**
 * The scrolling list of a navigation column, under its title. Rows pass beneath the title's glass;
 * the inset scrollbar runs from below the title to the bottom and shows while scrolling or hovered.
 * Short content (an empty list's message) fills the column under the title.
 */
export function PageNavContent({ scrollRef, header, className, children }: PageNavContentProps) {
  return (
    <PageScroll
      header={header}
      scrollRef={scrollRef}
      contentClassName={classNames(css.PageNavContent, className)}
      scrollbarClassName={css.PageNavTrack}
    >
      {children}
    </PageScroll>
  );
}

// Flex children may shrink below their content, so long rooms and threads scroll inside.
const PAGE_MIN_SIZE = { minHeight: 0, minWidth: 0 };

export const Page = as<'div'>(({ className, ...props }, ref) => {
  const pageClass = classNames(
    ContainerColor({ variant: 'Surface' }),
    PageSurface,
    useInheritSurfaceClass(),
    className
  );
  return (
    <Box
      direction="Column"
      grow="Yes"
      style={PAGE_MIN_SIZE}
      className={pageClass}
      {...props}
      ref={ref}
    />
  );
});

type PageHeaderProps = Pick<ComponentProps<typeof Header>, 'variant'> & {
  outlined?: boolean;
  balance?: boolean;
};

export const PageHeader = as<'header', PageHeaderProps>(
  ({ className, outlined, balance, variant = 'Surface', ...props }, ref) => {
    const headerClass = classNames(css.PageHeader({ outlined, balance }), className);
    return (
      <Header
        variant={variant}
        size="600"
        as="header"
        className={headerClass}
        {...props}
        ref={ref}
      />
    );
  }
);

/** A plain `div` that always carries `baseClass` beside any class the caller adds. */
const classedDiv = (baseClass: string) =>
  as<'div'>(({ className, ...props }, ref) => (
    <div {...props} ref={ref} className={classNames(baseClass, className)} />
  ));

export const PageContent = classedDiv(css.PageContent);

export const PageContentCenter = classedDiv(css.PageContentCenter);

/** The narrow centered column that holds a `PageHero` and whatever follows it. */
export const PageHeroSection = classedDiv(css.PageHeroSection);

type PageHeroProps = {
  icon: ReactNode;
  title: ReactNode;
  subTitle?: ReactNode;
  children?: ReactNode;
};

/** Centered icon, title, and subtitle at the top of an empty or welcome page. */
export function PageHero({ icon, title, subTitle, children }: PageHeroProps) {
  const heading = (
    <Box alignItems="Center" gap="200" direction="Column">
      {/* The page's title; the subtitle under it is not part of the heading. */}
      <Text as="h1" size="H2" align="Center">
        {title}
      </Text>
      {subTitle ? (
        <Text priority="400" align="Center">
          {subTitle}
        </Text>
      ) : null}
    </Box>
  );

  return (
    <Box gap="400" direction="Column">
      <Box alignItems="Center" gap="200" direction="Column">
        {icon}
      </Box>
      {heading}
      {children}
    </Box>
  );
}
