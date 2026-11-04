import { type MouseEvent, type ReactNode, useState } from 'react';
import { Icon, IconButton, Icons, toRem, type RectCords } from 'folds';
import FocusTrap from 'focus-trap-react';
import { PopOut } from '../../components/directional';
import { Menu } from '../../components/glass/GlassPrimitives';
import { stopPropagation } from '../../utils/keyboard';

type NavOptionsMenuProps = {
  /** The button's name; its own, so it is not taken for a room's More Options button. */
  label: string;
  /** The menu's width in pixels. */
  width?: number;
  /** The menu's groups; `close` dismisses the menu, for entries that act. */
  children: (close: () => void) => ReactNode;
};

/** Escape or a click elsewhere closes the menu, and focus stays where it is. */
const lightDismiss = (onClose: () => void) => ({
  onDeactivate: onClose,
  escapeDeactivates: stopPropagation,
  clickOutsideDeactivates: true,
  initialFocus: false as const,
  returnFocusOnDeactivate: false,
});

/**
 * The options button at the end of a navigation list's header (Home, Direct Messages, a space),
 * with the menu it opens below it.
 */
export function NavOptionsMenu({ label, width = 160, children }: NavOptionsMenuProps) {
  const [anchor, setAnchor] = useState<RectCords>();
  const close = () => setAnchor(undefined);
  const open = (event: MouseEvent<HTMLButtonElement>) =>
    setAnchor(event.currentTarget.getBoundingClientRect());

  const menu = (
    <FocusTrap focusTrapOptions={lightDismiss(close)}>
      <Menu style={{ width: '100vw', maxWidth: toRem(width) }}>{children(close)}</Menu>
    </FocusTrap>
  );

  return (
    <>
      <IconButton variant="Background" aria-label={label} onClick={open}>
        <Icon size="200" src={Icons.VerticalDots} />
      </IconButton>
      <PopOut anchor={anchor} position="Bottom" align="End" offset={6} content={menu} />
    </>
  );
}
