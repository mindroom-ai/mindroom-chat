import React, { ComponentProps, Ref } from 'react';
import classNames from 'classnames';
import {
  ContainerColor,
  Chip as FoldsChip,
  Dialog as FoldsDialog,
  Header as FoldsHeader,
  IconButton as FoldsIconButton,
  Menu as FoldsMenu,
  MenuItem as FoldsMenuItem,
  Modal as FoldsModal,
  as,
} from 'folds';
import { ContainerColor as containerColor } from '../../styles/ContainerColor.css';
import { glassFloating, glassOutline, glassSurface } from '../../styles/Glass.css';
import { useLiquidGlass } from './liquid/useLiquidGlass';
import { SurfaceProvider, useSurfaceContext } from './SurfaceContext';
import { inheritSurface } from './Surface.css';

export type SurfaceAppearance = 'glass' | 'plain' | 'inherit';
type AppearanceProps = { appearance?: SurfaceAppearance };
type SurfaceLevel = 'overlay' | 'panel' | 'control';

const useSurface = (
  ref: Ref<HTMLElement> | undefined,
  appearance: SurfaceAppearance,
  level: SurfaceLevel,
  variant: ContainerColor
) => {
  const enclosingSurface = useSurfaceContext();
  const glass = appearance === 'glass';
  return {
    ref: useLiquidGlass(ref, glass),
    className: classNames(
      glass && glassSurface({ level, variant }),
      appearance === 'inherit' && inheritSurface
    ),
    context: glass || (appearance === 'inherit' && enclosingSurface),
  };
};

type SurfaceProps = AppearanceProps & { level?: SurfaceLevel; variant?: ContainerColor };

type IconButtonProps = Pick<
  ComponentProps<typeof FoldsIconButton>,
  'variant' | 'size' | 'radii' | 'outlined'
>;

// Small controls share the material without an optical filter or observer per button.
export const IconButton = as<'button', IconButtonProps>(
  ({ className, variant = 'SurfaceVariant', ...props }, ref) => (
    <FoldsIconButton
      {...props}
      ref={ref}
      variant={variant}
      className={classNames(glassSurface({ level: 'control', variant }), className)}
    />
  )
);

type ChipProps = Pick<
  ComponentProps<typeof FoldsChip>,
  'variant' | 'size' | 'radii' | 'before' | 'after'
>;

export const Chip = as<'button', ChipProps>(
  ({ className, variant = 'SurfaceVariant', ...props }, ref) => (
    <FoldsChip
      {...props}
      ref={ref}
      variant={variant}
      className={classNames(
        glassSurface({ level: 'control', variant }),
        glassFloating,
        glassOutline,
        className
      )}
    />
  )
);

/** Shared material for custom floating panels; preserves the caller's DOM element. */
export const Surface = as<'div', SurfaceProps>(
  (
    {
      as: As = 'div',
      appearance = 'glass',
      level = 'overlay',
      variant = 'Surface',
      className,
      ...props
    },
    ref
  ) => {
    const surface = useSurface(ref, appearance, level, variant);
    return (
      <SurfaceProvider value={surface.context}>
        <As
          {...props}
          ref={surface.ref}
          className={classNames(
            containerColor({ variant }),
            surface.className,
            appearance === 'glass' && level === 'overlay' && glassFloating,
            className
          )}
        />
      </SurfaceProvider>
    );
  }
);

type MenuProps = Pick<ComponentProps<typeof FoldsMenu>, 'variant'> & AppearanceProps;
export const Menu = as<'div', MenuProps>(
  ({ className, variant = 'Surface', appearance = 'glass', ...props }, ref) => {
    const surface = useSurface(ref, appearance, 'overlay', variant);
    return (
      <SurfaceProvider value={surface.context}>
        <FoldsMenu
          {...props}
          ref={surface.ref}
          variant={variant}
          className={classNames(
            surface.className,
            appearance === 'glass' && glassFloating,
            className
          )}
        />
      </SurfaceProvider>
    );
  }
);

type ModalProps = Pick<ComponentProps<typeof FoldsModal>, 'variant' | 'size' | 'flexHeight'> &
  AppearanceProps;
export const Modal = as<'div', ModalProps>(
  ({ className, variant = 'Surface', appearance = 'glass', ...props }, ref) => {
    const surface = useSurface(ref, appearance, 'overlay', variant);
    return (
      <SurfaceProvider value={surface.context}>
        <FoldsModal
          {...props}
          ref={surface.ref}
          variant={variant}
          className={classNames(surface.className, className)}
        />
      </SurfaceProvider>
    );
  }
);

type DialogProps = Pick<ComponentProps<typeof FoldsDialog>, 'variant'> & AppearanceProps;
export const Dialog = as<'div', DialogProps>(
  ({ className, variant = 'Surface', appearance = 'glass', ...props }, ref) => {
    const surface = useSurface(ref, appearance, 'overlay', variant);
    return (
      <SurfaceProvider value={surface.context}>
        <FoldsDialog
          {...props}
          ref={surface.ref}
          variant={variant}
          className={classNames(surface.className, className)}
        />
      </SurfaceProvider>
    );
  }
);

type HeaderProps = Pick<ComponentProps<typeof FoldsHeader>, 'variant' | 'size'> & AppearanceProps;
export const Header = as<'header', HeaderProps>(
  ({ className, variant = 'Surface', appearance, ...props }, ref) => {
    const enclosingSurface = useSurfaceContext();
    // Semantic foregrounds need their matching fill to retain text contrast.
    const neutral = ['Background', 'Surface', 'SurfaceVariant'].includes(variant);
    const surface = useSurface(
      ref,
      appearance ?? (enclosingSurface && neutral ? 'inherit' : 'glass'),
      'panel',
      variant
    );
    return (
      <SurfaceProvider value={surface.context}>
        <FoldsHeader
          {...props}
          ref={surface.ref}
          variant={variant}
          className={classNames(surface.className, className)}
        />
      </SurfaceProvider>
    );
  }
);

// Menu rows must leave the material behind them visible; explicit soft fills
// still provide semantic selection and emphasis where callers request them.
type MenuItemProps = Pick<
  ComponentProps<typeof FoldsMenuItem>,
  'variant' | 'fill' | 'size' | 'radii' | 'before' | 'after'
>;
export const MenuItem = as<'button', MenuItemProps>(({ fill = 'None', ...props }, ref) => (
  <FoldsMenuItem {...props} fill={fill} ref={ref} />
));
