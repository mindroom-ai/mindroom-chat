import React, { ComponentProps, ReactNode, createContext, useContext } from 'react';
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

/** Whether the enclosing row is the open page, for its action's `aria-current`. */
const NavItemSelectedContext = createContext(false);

/** Roles that may carry `aria-selected`; a plain row is none of them. */
const SELECTABLE_ROLES = new Set(['option', 'tab', 'row', 'gridcell', 'treeitem']);

/**
 * One row of sidebar navigation. Callers mark the open row with `aria-selected`; the row shows it
 * as `data-selected` and its action (`NavLink`, `NavButton`) tells assistive technology with
 * `aria-current`, since `aria-selected` belongs to options and tabs. `data-highlight` tells
 * whether the row shows as unread.
 */
export const NavItem = as<'div', NavItemProps>(
  (
    {
      as: AsNavItem = 'div',
      className,
      variant,
      radii,
      highlight,
      'aria-selected': ariaSelected,
      ...props
    },
    ref
  ) => {
    const selected = ariaSelected === true || ariaSelected === 'true';
    const keepsAriaSelected = SELECTABLE_ROLES.has(props.role ?? '');
    return (
      <NavItemSelectedContext.Provider value={selected}>
        <AsNavItem
          className={classNames(css.NavItem({ variant, radii, highlight }), className)}
          data-highlight={highlight ? 'true' : 'false'}
          data-selected={selected ? 'true' : undefined}
          aria-selected={keepsAriaSelected ? ariaSelected : undefined}
          {...props}
          ref={ref}
        />
      </NavItemSelectedContext.Provider>
    );
  }
);

/** The row's main action as a button; it takes the row's full width up to the options. */
export const NavButton = as<'button'>(({ as: AsButton = 'button', className, ...props }, ref) => {
  const selected = useContext(NavItemSelectedContext);
  return (
    <AsButton
      className={classNames(css.NavAction, className)}
      aria-current={selected ? 'true' : undefined}
      {...props}
      ref={ref}
    />
  );
});

type NavLinkProps = ComponentProps<typeof Link>;

/** The row's main action as a router link; the open row's link is the current page. */
export const NavLink = React.forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLink(
  { className, ...linkProps },
  ref
) {
  const selected = useContext(NavItemSelectedContext);
  return (
    <Link
      aria-current={selected ? 'page' : undefined}
      {...linkProps}
      ref={ref}
      className={classNames(css.NavAction, className)}
    />
  );
});

/** Icon and label inside a row's action. */
export const NavItemContent = as<'div'>(({ as: AsContent = 'div', className, ...props }, ref) => (
  <AsContent className={classNames(css.NavItemContent, className)} {...props} ref={ref} />
));

/** Trailing controls of a row, outside its main action. */
export const NavItemOptions = as<'div'>(({ as: Options = 'div', className, ...rest }, ref) => (
  <Options {...rest} ref={ref} className={classNames(css.NavItemOptions, className)} />
));

/** A group of rows under a NavCategoryHeader. */
export const NavCategory = as<'div'>(({ as: AsCategory = 'div', className, ...props }, ref) => (
  <AsCategory className={classNames(css.NavCategory, className)} {...props} ref={ref} />
));

/** Centers its children in the space a list would take. */
export const NavEmptyCenter = as<'div'>(({ as: Center = 'div', className, ...rest }, ref) => (
  <Center {...rest} ref={ref} className={classNames(css.NavEmptyCenter, className)} />
));

/** Every part is optional; `options` holds the actions under the text, such as "Create Room". */
type EmptySlots = Partial<Record<'icon' | 'title' | 'content' | 'options', ReactNode>>;

/** What a sidebar list shows while it has nothing in it. */
export function NavEmptyLayout({ icon, title, content, options }: EmptySlots) {
  return (
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
