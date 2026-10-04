import React, { ComponentProps, MutableRefObject, ReactNode, useRef } from 'react';
import { Box, Line, Scroll, Text, as } from 'folds';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { Header } from '../glass/GlassPrimitives';
import { useSurfaceContext } from '../glass/SurfaceContext';
import { inheritSurface } from '../glass/Surface.css';
import { ContainerColor } from '../../styles/ContainerColor.css';
import * as css from './style.css';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { InsetScrollbar } from '../inset-scrollbar/InsetScrollbar';

type PageRootProps = {
  nav: ReactNode;
  children: ReactNode;
};

export function PageRoot({ nav, children }: PageRootProps) {
  const screenSize = useScreenSizeContext();
  const enclosingSurface = useSurfaceContext();

  return (
    <Box
      grow="Yes"
      className={classNames(
        ContainerColor({ variant: 'Background' }),
        enclosingSurface && inheritSurface
      )}
    >
      {nav}
      {nav && screenSize !== ScreenSize.Mobile && (
        <Line variant="Background" size="300" direction="Vertical" />
      )}
      {children}
    </Box>
  );
}

type ClientDrawerLayoutProps = {
  children: ReactNode;
};
export function PageNav({ size, children }: ClientDrawerLayoutProps & css.PageNavVariants) {
  const screenSize = useScreenSizeContext();
  const isMobile = screenSize === ScreenSize.Mobile;

  return (
    <Box
      grow={isMobile ? 'Yes' : undefined}
      className={css.PageNav({ size })}
      shrink={isMobile ? 'Yes' : 'No'}
    >
      <Box grow="Yes" direction="Column">
        {children}
      </Box>
    </Box>
  );
}

// Navigation lists scroll under this sticky header, so it keeps its own frosted
// material inside settings modals too; a transparent header let rows overlap its title.
export const PageNavHeader = as<'header'>(({ className, ...props }, ref) => (
  <Header
    className={classNames(css.PageNavHeader, css.PageNavHeaderMaterial, className)}
    appearance="plain"
    variant="Background"
    size="600"
    {...props}
    ref={ref}
  />
));

export function PageNavContent({
  scrollRef,
  header,
  children,
}: {
  children: ReactNode;
  /** Navigation titles stay inside the viewport so every list scrolls behind them. */
  header: ReactNode;
  scrollRef?: MutableRefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const fallbackScrollRef = useRef<HTMLDivElement>(null);
  const viewportRef = scrollRef ?? fallbackScrollRef;
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <Box grow="Yes" direction="Column" style={{ position: 'relative' }}>
      <Scroll
        ref={viewportRef}
        className={css.PageNavHeaderScroll}
        variant="Background"
        direction="Vertical"
        size="300"
        hideTrack
        visibility="Hover"
      >
        {header}
        <div ref={contentRef} className={css.PageNavContent}>
          {children}
        </div>
        <InsetScrollbar
          scrollRef={viewportRef}
          contentRef={contentRef}
          className={css.PageNavScrollbar}
          label={t('commandPalette.navigate')}
        />
      </Scroll>
    </Box>
  );
}

export const Page = as<'div'>(({ className, ...props }, ref) => {
  const enclosingSurface = useSurfaceContext();
  return (
    <Box
      grow="Yes"
      direction="Column"
      className={classNames(
        ContainerColor({ variant: 'Surface' }),
        enclosingSurface && inheritSurface,
        className
      )}
      {...props}
      ref={ref}
    />
  );
});

export const PageHeader = as<
  'div',
  css.PageHeaderVariants & Pick<ComponentProps<typeof Header>, 'appearance'> & { flat?: boolean }
>(({ className, outlined, balance, appearance, flat, ...props }, ref) => (
  <Header
    as="header"
    size="600"
    appearance={flat ? 'plain' : appearance}
    className={classNames(
      css.PageHeader({ balance, outlined: flat ? false : outlined }),
      flat && css.PageHeaderMaterial,
      className
    )}
    {...props}
    ref={ref}
  />
));

/** Page chrome stays inside the native viewport so content can pass beneath it. */
export function PageScroll({
  header,
  scrollRef,
  children,
}: {
  header?: ReactNode;
  scrollRef?: MutableRefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const fallbackScrollRef = useRef<HTMLDivElement>(null);
  const viewportRef = scrollRef ?? fallbackScrollRef;
  const contentRef = useRef<HTMLDivElement>(null);
  const hasHeader = !!header;

  return (
    <Box grow="Yes" direction="Column" style={{ position: 'relative' }}>
      <Scroll
        ref={viewportRef}
        className={css.PageScroll({ header: hasHeader })}
        hideTrack
        visibility="Hover"
      >
        <div ref={contentRef} className={css.PageScrollContent}>
          {hasHeader && <div className={css.PageScrollHeader}>{header}</div>}
          <div className={css.PageScrollBody}>{children}</div>
        </div>
        <InsetScrollbar
          scrollRef={viewportRef}
          contentRef={contentRef}
          className={css.PageScrollbar({ header: hasHeader })}
          label={t('commandPalette.navigate')}
        />
      </Scroll>
    </Box>
  );
}

export const PageContent = as<'div'>(({ className, ...props }, ref) => (
  <div className={classNames(css.PageContent, className)} {...props} ref={ref} />
));

export function PageHeroEmpty({ children }: { children: ReactNode }) {
  return (
    <Box
      className={classNames(ContainerColor({ variant: 'SurfaceVariant' }), css.PageHeroEmpty)}
      direction="Column"
      alignItems="Center"
      justifyContent="Center"
      gap="200"
    >
      {children}
    </Box>
  );
}

export const PageHeroSection = as<'div', ComponentProps<typeof Box>>(
  ({ className, ...props }, ref) => (
    <Box
      direction="Column"
      className={classNames(css.PageHeroSection, className)}
      {...props}
      ref={ref}
    />
  )
);

export function PageHero({
  icon,
  title,
  subTitle,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  subTitle: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Box direction="Column" gap="400">
      <Box direction="Column" alignItems="Center" gap="200">
        {icon}
      </Box>
      <Box as="h2" direction="Column" gap="200" alignItems="Center">
        <Text align="Center" size="H2">
          {title}
        </Text>
        <Text align="Center" priority="400">
          {subTitle}
        </Text>
      </Box>
      {children}
    </Box>
  );
}

export const PageContentCenter = as<'div'>(({ className, ...props }, ref) => (
  <div className={classNames(css.PageContentCenter, className)} {...props} ref={ref} />
));
