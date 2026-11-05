import { ReactNode, RefCallback, createContext, useContext } from 'react';
import classNames from 'classnames';
import { Text, Tooltip, as } from 'folds';
import { TooltipProvider } from '../directional';
import { glassSurface } from '../styles/Glass.css';
import { ShortcutLabel } from '../../shortcuts/ShortcutKeys';
import type { ShortcutId } from '../../shortcuts/shortcuts';
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

/** Whether the enclosing rail entry is the open section, for its button's `aria-current`. */
const SidebarItemActiveContext = createContext(false);

/**
 * One rail entry; `active` shows the selected-tab indicator, and the entry's button tells
 * assistive technology with `aria-current`.
 */
export const SidebarItem = as<'div', { active?: boolean }>((props, ref) => {
  const { as: Item = 'div', active, className, ...rest } = props;
  return (
    <SidebarItemActiveContext.Provider value={!!active}>
      <Item
        ref={ref}
        {...rest}
        data-active={active || undefined}
        className={classNames(css.SidebarItem({ active }), className)}
      />
    </SidebarItemActiveContext.Provider>
  );
});

type SidebarItemTooltipProps = {
  tooltip?: ReactNode;
  /** The keyboard shortcut for the button's action, shown after a text tooltip. */
  shortcut?: ShortcutId;
  children: (triggerRef: RefCallback<HTMLElement>) => ReactNode;
};

/** Names a rail button in a tooltip to its right. */
export function SidebarItemTooltip({ tooltip, shortcut, children }: SidebarItemTooltipProps) {
  if (!tooltip) return <>{children(() => undefined)}</>;

  return (
    <TooltipProvider
      position="Right"
      delay={400}
      tooltip={
        <Tooltip>
          {typeof tooltip === 'string' ? (
            <ShortcutLabel label={tooltip} id={shortcut} />
          ) : (
            <Text size="T300">{tooltip}</Text>
          )}
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
};

/** The rounded square holding a rail entry's icon or avatar. */
export const SidebarAvatar = as<'div', SidebarAvatarProps>((props, ref) => {
  const { as: Square = 'div', size, outlined, className, ...rest } = props;
  const active = useContext(SidebarItemActiveContext);
  const variantClass = css.SidebarAvatar({ size, outlined });
  const material = outlined && glassSurface({ level: 'control', variant: 'Secondary' });
  // The entry's own button is the open section.
  const current = active && (Square as string) === 'button' ? 'page' : undefined;
  return (
    <Square
      ref={ref}
      aria-current={current}
      {...rest}
      className={classNames(variantClass, material, className)}
    />
  );
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
