import React, { ComponentProps, ReactNode, RefObject } from 'react';
import classNames from 'classnames';
import { Box, Icon, IconSrc, Line, Scroll, Text, as } from 'folds';
import { Header } from '../glass/GlassPrimitives';
import { useSurfaceContext } from '../glass/SurfaceContext';
import { inheritSurface } from '../glass/Surface.css';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import * as css from './style.css';









  // Inside a glass surface (the settings dialog) the page reveals the material behind it.
  const insideSurface = useSurfaceContext();

  return (
    <Box
      grow="Yes"
      className={classNames(
        ContainerColor({ variant: 'Background' }),
        insideSurface && inheritSurface
      )}
    >
      {nav}









  size?: '400' | '300';
  children: ReactNode;
};









      direction="Column"
    >
      {children}
    </Box>
  );
}

export const PageNavHeader = as<'header', { outlined?: boolean; scroll?: boolean }>(












  scrollRef?: RefObject<HTMLDivElement>;
  children: ReactNode;
};

export function PageNavContent({ scrollRef, children }: PageNavContentProps) {
  return (
















  const insideSurface = useSurfaceContext();

  return (
    <Box
      grow="Yes"
      direction="Column"
      className={classNames(
        ContainerColor({ variant: 'Surface' }),
        insideSurface && inheritSurface,
        className
      )}
      style={{ minWidth: 0, minHeight: 0 }}
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
  ({ className, outlined, balance, variant = 'Surface', ...props }, ref) => (
    <Header
      as="header"
      size="600"


























  <Box
    alignItems="Center"
    justifyContent="Center"
    className={classNames(css.PageHeroEmpty, className)}
    {...props}
    ref={ref}
  />
));

type PageHeroProps = {
  icon: ReactNode;
  title: ReactNode;
  subTitle?: ReactNode;
  children?: ReactNode;
};

/** Centered icon, title, and subtitle at the top of an empty or welcome page. */







        <Text align="Center" size="H2">
          {title}
        </Text>
        {subTitle && (
          <Text align="Center" priority="400">
            {subTitle}
          </Text>
        )}
      </Box>
      {children}
    </Box>
  );
}

/** Large icon for a PageHero. */
export function PageHeroIcon({ src }: { src: IconSrc }) {
  return <Icon size="600" src={src} />;
}
