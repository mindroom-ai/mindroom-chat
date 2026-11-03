import React, { ReactNode, RefCallback } from 'react';
import classNames from 'classnames';
import { Text, Tooltip, TooltipProvider, as } from 'folds';
import * as css from './SidebarItem.css';

/** The icon rail at the left edge of the client. */




/** A column of rail items. */


));

export function SidebarStackSeparator() {
  return <div role="separator" className={css.SidebarStackSeparator} />;
}

/** One rail entry; `active` shows the selected-tab indicator. */
export const SidebarItem = as<'div', { active?: boolean }>(



      data-active={active || undefined}
      {...props}
      ref={ref}
    />
  )
);

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

/** The rounded square holding a rail entry's icon or avatar. */
export const SidebarAvatar = as<'div', { size?: '400' | '300' | '200'; outlined?: boolean }>(



















