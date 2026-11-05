import React, { ReactNode } from 'react';
import { toRem } from 'folds';
import { PopOut } from '../../ui/directional';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { Menu } from '../../ui/glass/GlassPrimitives';
import { MenuGroup } from '../../ui/MenuEntry';
import { stopPropagation } from '../../lib/keyboard';

type SidebarContextMenuProps = {
  anchor?: RectCords;
  onClose: () => void;
  children: ReactNode;
};

/** The right-click menu of an icon rail button, opened beside it. */
export function SidebarContextMenu({ anchor, onClose, children }: SidebarContextMenuProps) {
  if (!anchor) return null;
  return (
    <PopOut
      anchor={anchor}
      position="Right"
      align="Start"
      content={
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            returnFocusOnDeactivate: false,
            onDeactivate: onClose,
            clickOutsideDeactivates: true,
            isKeyForward: (event: KeyboardEvent) => event.key === 'ArrowDown',
            isKeyBackward: (event: KeyboardEvent) => event.key === 'ArrowUp',
            escapeDeactivates: stopPropagation,
          }}
        >
          <Menu style={{ width: '100vw', maxWidth: toRem(200) }}>
            <MenuGroup>{children}</MenuGroup>
          </Menu>
        </FocusTrap>
      }
    />
  );
}

/** Toggles the menu at the clicked button, instead of the browser's own. */
export const toggleContextMenu =
  (setAnchor: (update: (current?: RectCords) => RectCords | undefined) => void) =>
  (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    const cords = event.currentTarget.getBoundingClientRect();
    setAnchor((current) => (current ? undefined : cords));
  };
