import { type CSSProperties, type ReactNode } from 'react';
import FocusTrap from 'focus-trap-react';
import { type RectCords } from 'folds';
import { PopOut } from '../directional';
import { Menu } from '../glass/GlassPrimitives';
import { stopPropagation } from '../../utils/keyboard';

type ProfilePopMenuProps = {
  /** Where the menu opens; it is closed while undefined. */
  at: RectCords | undefined;
  onClose: () => void;
  label: string;
  /** The chip or button that opens the menu. */
  trigger: ReactNode;
  children: ReactNode;
  menuStyle?: CSSProperties;
};

/**
 * A menu that drops below a chip of the profile card. Escape stays inside the card (so the card
 * itself stays open) and a click elsewhere closes the menu.
 */
export function ProfilePopMenu({
  at,
  onClose,
  label,
  trigger,
  children,
  menuStyle,
}: ProfilePopMenuProps) {
  const trap = {
    onDeactivate: onClose,
    escapeDeactivates: stopPropagation,
    clickOutsideDeactivates: true,
    initialFocus: false as const,
  };
  const menu = (
    <FocusTrap focusTrapOptions={trap}>
      <Menu aria-label={label} role="menu" style={menuStyle}>
        {children}
      </Menu>
    </FocusTrap>
  );
  return (
    <PopOut content={menu} anchor={at} offset={4} align="Start" position="Bottom">
      {trigger}
    </PopOut>
  );
}
