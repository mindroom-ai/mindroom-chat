import React, { ComponentProps } from 'react';
import classNames from 'classnames';
import {
  Dialog as FoldsDialog,
  Header as FoldsHeader,
  Menu as FoldsMenu,
  MenuItem as FoldsMenuItem,
  Modal as FoldsModal,
  as,
} from 'folds';
import { glassSurface } from '../../styles/Glass.css';
import { useLiquidGlass } from './liquid/useLiquidGlass';

type MenuProps = Pick<ComponentProps<typeof FoldsMenu>, 'variant'>;
export const Menu = as<'div', MenuProps>(({ className, variant = 'Surface', ...props }, ref) => {
  const glassRef = useLiquidGlass(ref);
  return (
    <FoldsMenu
      {...props}
      ref={glassRef}
      variant={variant}
      className={classNames(glassSurface({ level: 'overlay', variant }), className)}
    />
  );
});

type ModalProps = Pick<ComponentProps<typeof FoldsModal>, 'variant' | 'size' | 'flexHeight'>;
export const Modal = as<'div', ModalProps>(({ className, variant = 'Surface', ...props }, ref) => {
  const glassRef = useLiquidGlass(ref);
  return (
    <FoldsModal
      {...props}
      ref={glassRef}
      variant={variant}
      className={classNames(glassSurface({ level: 'overlay', variant }), className)}
    />
  );
});

type DialogProps = Pick<ComponentProps<typeof FoldsDialog>, 'variant'>;
export const Dialog = as<'div', DialogProps>(
  ({ className, variant = 'Surface', ...props }, ref) => {
    const glassRef = useLiquidGlass(ref);
    return (
      <FoldsDialog
        {...props}
        ref={glassRef}
        variant={variant}
        className={classNames(glassSurface({ level: 'overlay', variant }), className)}
      />
    );
  }
);

type HeaderProps = Pick<ComponentProps<typeof FoldsHeader>, 'variant' | 'size'>;
export const Header = as<'header', HeaderProps>(
  ({ className, variant = 'Surface', ...props }, ref) => {
    const glassRef = useLiquidGlass(ref);
    return (
      <FoldsHeader
        {...props}
        ref={glassRef}
        variant={variant}
        className={classNames(glassSurface({ level: 'panel', variant }), className)}
      />
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
