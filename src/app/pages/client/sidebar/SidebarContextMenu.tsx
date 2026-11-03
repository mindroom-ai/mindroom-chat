import React, { ReactNode } from 'react';
import { Box, PopOut, config, toRem } from 'folds';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { Menu } from '../../../components/glass/GlassPrimitives';
import { stopPropagation } from '../../../utils/keyboard';

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



            </Box>
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
