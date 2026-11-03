import React, { ComponentProps, ReactNode } from 'react';
import classNames from 'classnames';
import { Link } from 'react-router-dom';
import { Box, as } from 'folds';
import * as css from './NavItem.css';

type NavItemVariant = 'Background' | 'Surface' | 'SurfaceVariant' | 'Primary' | 'Secondary';

type NavItemProps = {
  variant?: NavItemVariant;
  radii?: '0' | '300' | '400' | '500' | 'Pill';
  /** Bold text, for unread rooms. */
  highlight?: boolean;
};

/** One row of sidebar navigation; selected rows set `aria-selected`. */
export const NavItem = as<'div', NavItemProps>(
  ({ as: AsNavItem = 'div', className, variant, radii, highlight, ...props }, ref) => (
    <AsNavItem
      className={classNames(css.NavItem({ variant, radii, highlight }), className)}









  <AsButton className={classNames(css.NavAction, className)} {...props} ref={ref} />
));

type NavLinkProps = ComponentProps<typeof Link>;

/** The row's main action as a router link. */







/** Icon and label inside a row's action. */
export const NavItemContent = as<'div'>(({ as: AsContent = 'div', className, ...props }, ref) => (
  <AsContent className={classNames(css.NavItemContent, className)} {...props} ref={ref} />
));

/** Trailing controls of a row, outside its main action. */


));

/** A group of rows under a NavCategoryHeader. */
export const NavCategory = as<'div'>(({ as: AsCategory = 'div', className, ...props }, ref) => (
  <AsCategory className={classNames(css.NavCategory, className)} {...props} ref={ref} />
));



));











    <div className={css.NavEmptyLayout}>
      {icon}
      {(title || content) && (
        <Box direction="Column" gap="100">
          {title}
          {content}
        </Box>
      )}
      {options}
    </div>
  );
}
