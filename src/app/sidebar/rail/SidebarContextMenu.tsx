import React, { ReactNode, useCallback, useState } from 'react';
import { toRem } from 'folds';
import { PopOut } from '../../ui/directional';
import type { RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { Menu } from '../../ui/glass/GlassPrimitives';
import { MenuGroup } from '../../ui/MenuEntry';
import { stopPropagation } from '../../lib/keyboard';
import { useLongPress } from '../../lib/hooks/useLongPress';

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

/**
 * The menu of a rail button, opened beside the button: a right-click toggles it, instead of the
 * browser's own menu, and a finger's long press opens it, since iOS fires no contextmenu for one
 * (Android's contextmenu for the same press only opens it). `buttonProps` go on the button; while
 * the menu is open the button looks pressed (`data-menu-open`).
 */
export function useSidebarContextMenu() {
  const [anchor, setAnchor] = useState<RectCords>();
  const longPress = useLongPress(
    (_x, _y, button) => setAnchor(button.getBoundingClientRect()),
    () => true
  );
  const close = useCallback(() => setAnchor(undefined), []);
  const onContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    const cords = event.currentTarget.getBoundingClientRect();
    const finger = (event.nativeEvent as Partial<PointerEvent>).pointerType === 'touch';
    setAnchor((current) => (current && !finger ? undefined : cords));
  };
  return {
    anchor,
    close,
    buttonProps: {
      ...longPress,
      onContextMenu,
      'data-menu-open': anchor ? 'true' : undefined,
    },
  };
}
