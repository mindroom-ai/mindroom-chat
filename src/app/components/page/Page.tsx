import React, { ComponentProps, ReactNode, RefObject } from 'react';
import classNames from 'classnames';
import { Box, Line, Scroll, Text, as, color, config } from 'folds';
import { Header } from '../glass/GlassPrimitives';
import { useSurfaceContext } from '../glass/SurfaceContext';
import { inheritSurface } from '../glass/Surface.css';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import * as css from './style.css';

const NAV_HEADER_OUTLINE = `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`;

type PageRootProps = {
  nav: ReactNode;
  children: ReactNode;
};

/** Inside a glass surface (the settings dialog) pages reveal the material behind them. */
const useInheritSurfaceClass = () => (useSurfaceContext() ? inheritSurface : undefined);

/** Page layout: optional navigation column, a divider, then the page itself. */
export function PageRoot({ nav, children }: PageRootProps) {
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const surfaceClass = useInheritSurfaceClass();
  // On mobile the navigation and the page take turns on screen, so nothing divides them.
  const divider =
    nav && !mobile ? <Line direction="Vertical" size="300" variant="Background" /> : null;

  return (
    <Box className={classNames(ContainerColor({ variant: 'Background' }), surfaceClass)} grow="Yes">
      {nav}
      {divider}
      {children}
    </Box>
  );
}

/** The navigation column; on mobile it takes the whole width instead of a fixed size. */
export function PageNav({ size, children }: { size?: '400' | '300'; children: ReactNode }) {
  const isMobile = useScreenSizeContext() === ScreenSize.Mobile;
  const columnClass = css.PageNav(isMobile ? undefined : { size });

  return (
    <Box direction="Column" className={columnClass} grow={isMobile ? 'Yes' : undefined}>
      {children}
    </Box>
  );
}

/**
 * The title bar of a navigation column. `scroll` keeps it pinned while the list scrolls under it;
 * `outlined` draws a line between it and the list (the reference screens have none by default).
 */
export const PageNavHeader = as<'header', { outlined?: boolean; scroll?: boolean }>(
  ({ scroll, outlined, className, style, ...props }, ref) => (
    <Header
      as="header"
      variant="Background"
      size="600"
      {...props}
      ref={ref}
      style={outlined ? { ...style, borderBottom: NAV_HEADER_OUTLINE } : style}
      className={classNames(css.PageNavHeader, scroll && css.PageNavHeaderScroll, className)}
    />
  )
);

type PageNavContentProps = {
  scrollRef?: RefObject<HTMLDivElement>;
  children: ReactNode;
};

/** The scrolling list under a navigation header; the scrollbar shows on hover only. */
export function PageNavContent({ scrollRef, children }: PageNavContentProps) {
  const list = <div className={css.PageNavContent}>{children}</div>;
  return (
    <Box style={{ minHeight: 0 }} direction="Column" grow="Yes">
      <Scroll
        ref={scrollRef}
        hideTrack
        visibility="Hover"
        size="300"
        direction="Vertical"
        variant="Background"
      >
        {list}
      </Scroll>
    </Box>
  );
}

// Flex children may shrink below their content, so long rooms and threads scroll inside.
const PAGE_MIN_SIZE = { minHeight: 0, minWidth: 0 };

export const Page = as<'div'>(({ className, ...props }, ref) => {
  const pageClass = classNames(
    ContainerColor({ variant: 'Surface' }),
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
    <Box as="h2" style={{ margin: 0 }} alignItems="Center" gap="200" direction="Column">
      <Text size="H2" align="Center">
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
