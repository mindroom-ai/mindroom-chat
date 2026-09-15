import React, { ComponentProps } from 'react';
import classNames from 'classnames';
import {
  Dialog as FoldsDialog,
  Header as FoldsHeader,
  Menu as FoldsMenu,
  Modal as FoldsModal,
  as,
} from 'folds';
import { glassSurface } from '../../styles/Glass.css';

type MenuProps = Pick<ComponentProps<typeof FoldsMenu>, 'variant'>;
export const Menu = as<'div', MenuProps>(({ className, variant = 'Surface', ...props }, ref) => (
  <FoldsMenu
    {...props}
    ref={ref}
    variant={variant}
    className={classNames(glassSurface({ level: 'overlay', variant }), className)}
  />
));

type ModalProps = Pick<ComponentProps<typeof FoldsModal>, 'variant' | 'size' | 'flexHeight'>;
export const Modal = as<'div', ModalProps>(({ className, variant = 'Surface', ...props }, ref) => (
  <FoldsModal
    {...props}
    ref={ref}
    variant={variant}
    className={classNames(glassSurface({ level: 'overlay', variant }), className)}
  />
));

type DialogProps = Pick<ComponentProps<typeof FoldsDialog>, 'variant'>;
export const Dialog = as<'div', DialogProps>(
  ({ className, variant = 'Surface', ...props }, ref) => (
    <FoldsDialog
      {...props}
      ref={ref}
      variant={variant}
      className={classNames(glassSurface({ level: 'overlay', variant }), className)}
    />
  )
);

type HeaderProps = Pick<ComponentProps<typeof FoldsHeader>, 'variant' | 'size'>;
export const Header = as<'header', HeaderProps>(
  ({ className, variant = 'Surface', ...props }, ref) => (
    <FoldsHeader
      {...props}
      ref={ref}
      variant={variant}
      className={classNames(glassSurface({ level: 'panel', variant }), className)}
    />
  )
);
