import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { toRem, type RectCords } from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { stopPropagation } from '../lib/keyboard';
import { PopOut } from '../ui/directional';
import { Menu } from '../ui/glass/GlassPrimitives';
import * as scrollableMenuCss from '../ui/ScrollableMenu.css';

export type SectionMenuPopOutProps = {
  anchor: RectCords;
  position?: 'Bottom' | 'Right';
  align?: 'Start' | 'End';
  /** Focus target restored only when Escape closes the menu (outside clicks never steal focus). */
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
};

/**
 * Shared anchored `220px` scrollable menu frame for sidebar section menus (`Home` and `Space`).
 * Traps keyboard navigation inside the popover, returns focus on Escape, and leaves outside clicks
 * focused on their target.
 */
export function SectionMenuPopOut({
  anchor,
  position = 'Bottom',
  align = 'Start',
  returnFocusTo,
  onClose,
  children,
}: SectionMenuPopOutProps) {
  const refocusOnCloseRef = useRef(false);
  const latestRef = useRef({ onClose, returnFocusTo });

  useLayoutEffect(() => {
    latestRef.current = { onClose, returnFocusTo };
  }, [onClose, returnFocusTo]);

  useLayoutEffect(() => {
    refocusOnCloseRef.current = false;
  }, [anchor]);

  return (
    <PopOut
      anchor={anchor}
      position={position}
      align={align}
      offset={4}
      content={
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            returnFocusOnDeactivate: false,
            clickOutsideDeactivates: true,
            escapeDeactivates: (event) => {
              if (!stopPropagation(event)) return false;
              refocusOnCloseRef.current = true;
              return true;
            },
            onDeactivate: () => {
              const { onClose: close, returnFocusTo: opener } = latestRef.current;
              close();
              if (refocusOnCloseRef.current) {
                refocusOnCloseRef.current = false;
                opener?.focus();
              }
            },
          }}
        >
          <Menu
            className={scrollableMenuCss.ScrollableMenu}
            style={{ width: '100vw', maxWidth: toRem(220) }}
          >
            <div className={scrollableMenuCss.ScrollableMenuRows}>{children}</div>
          </Menu>
        </FocusTrap>
      }
    />
  );
}
