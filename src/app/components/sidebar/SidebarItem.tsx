import React, { ReactNode, RefCallback } from 'react';
import classNames from 'classnames';
import { Text, Tooltip, TooltipProvider, as } from 'folds';
import { glassSurface } from '../../styles/Glass.css';
import * as css from './SidebarItem.css';

/** The icon rail at the left edge of the client. */
export const Sidebar = as<'nav'>((props, ref) => {
  const { as: Rail = 'nav', className, ...rest } = props;
  return <Rail ref={ref} {...rest} className={classNames(css.Sidebar, className)} />;
});

/** A column of rail items. */
export const SidebarStack = as<'div'>((props, ref) => {
  const { as: Stack = 'div', className, ...rest } = props;
  return <Stack ref={ref} {...rest} className={classNames(css.SidebarStack, className)} />;
});

export function SidebarStackSeparator() {
  return <div role="separator" className={css.SidebarStackSeparator} />;
}

/** One rail entry; `active` shows the selected-tab indicator. */
export const SidebarItem = as<'div', { active?: boolean }>((props, ref) => {
  const { as: Item = 'div', active, className, ...rest } = props;
  return (
    <Item
      ref={ref}
      {...rest}
      data-active={active || undefined}
      className={classNames(css.SidebarItem({ active }), className)}
    />
  );
});

type SidebarItemTooltipProps = {
  tooltip?: ReactNode;
  children: (triggerRef: RefCallback<HTMLElement>) => ReactNode;
};

/** Names a rail button in a tooltip to its right. */
export function SidebarItemTooltip({ tooltip, children }: SidebarItemTooltipProps) {
  if (!tooltip) return <>{children(() => undefined)}</>;

  return (
    <TooltipProvider
      position="Right"
      delay={400}
      tooltip={
        <Tooltip>
          <Text size="T300">{tooltip}</Text>
        </Tooltip>
      }
    >
      {(triggerRef) => children(triggerRef as RefCallback<HTMLElement>)}
    </TooltipProvider>
  );
}

type SidebarAvatarProps = {
  size?: '400' | '300' | '200';
  outlined?: boolean;
  /** A small action on the corner of the entry beside it, shown while that entry is engaged. */
  corner?: boolean;
};

/** The rounded square holding a rail entry's icon or avatar. */
export const SidebarAvatar = as<'div', SidebarAvatarProps>((props, ref) => {
  const { as: Square = 'div', size, outlined, corner, className, ...rest } = props;
  const variantClass = css.SidebarAvatar({ size, outlined, corner });
  const material = outlined && glassSurface({ level: 'control', variant: 'Secondary' });
  return <Square ref={ref} {...rest} className={classNames(variantClass, material, className)} />;
});

/** The unread badge on a rail entry; `hasCount` moves it out to fit a number. */
export const SidebarItemBadge = as<'div', { hasCount?: boolean }>((props, ref) => {
  const { as: Badge = 'div', hasCount, className, ...rest } = props;
  return (
    <Badge
      ref={ref}
      {...rest}
      className={classNames(css.SidebarItemBadge({ hasCount }), className)}
    />
  );
});
