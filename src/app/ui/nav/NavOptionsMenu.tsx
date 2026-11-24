import { type MouseEvent, type ReactNode, useCallback, useRef, useState } from 'react';
import { Icon, IconButton, Icons, toRem, type IconSrc, type RectCords } from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { PopOut } from '../directional';
import { Menu } from '../glass/GlassPrimitives';
import * as scrollableMenuCss from '../ScrollableMenu.css';
import { stopPropagation } from '../../lib/keyboard';
import { LoneTouchTarget } from '../styles/TouchTarget.css';

type NavOptionsMenuProps = {
  /** The button's name; its own, so it is not taken for a room's More Options button. */
  label: string;
  /** The button's icon; defaults to vertical dots. */
  icon?: IconSrc;
  /** The menu's width in pixels. */
  width?: number;
  /** Highlights the trigger button with a soft Primary fill when non-default state is active. */
  active?: boolean;
  /** Explicit ARIA role on the menu container (labels it with `label` when set). */
  menuRole?: string;
  /** Touch-target or layout class on the trigger button; defaults to `LoneTouchTarget`. */
  buttonClassName?: string;
  /** The menu's groups; `close` dismisses the menu, for entries that act. */
  children: (close: () => void) => ReactNode;
};

/**
 * An action or options button at the end of a navigation list's header (Home, Direct Messages, a
 * space), with the menu it opens below it.
 */
export function NavOptionsMenu({
  label,
  icon = Icons.VerticalDots,
  width = 160,
  active = false,
  menuRole,
  buttonClassName = LoneTouchTarget,
  children,
}: NavOptionsMenuProps) {
  const [anchor, setAnchor] = useState<RectCords>();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const refocusOnCloseRef = useRef(false);

  const close = useCallback(() => {
    setAnchor(undefined);
    if (refocusOnCloseRef.current) {
      refocusOnCloseRef.current = false;
      buttonRef.current?.focus();
    }
  }, []);

  const open = (event: MouseEvent<HTMLButtonElement>) => {
    refocusOnCloseRef.current = false;
    setAnchor(event.currentTarget.getBoundingClientRect());
  };

  const menu = (
    <FocusTrap
      focusTrapOptions={{
        onDeactivate: close,
        escapeDeactivates: (event) => {
          if (!stopPropagation(event)) return false;
          refocusOnCloseRef.current = true;
          return true;
        },
        clickOutsideDeactivates: true,
        initialFocus: false,
        returnFocusOnDeactivate: false,
      }}
    >
      <Menu
        role={menuRole}
        aria-label={menuRole ? label : undefined}
        className={scrollableMenuCss.ScrollableMenu}
        style={{ width: '100vw', maxWidth: toRem(width) }}
      >
        <div className={scrollableMenuCss.ScrollableMenuRows}>{children(close)}</div>
      </Menu>
    </FocusTrap>
  );

  return (
    <>
      <IconButton
        ref={buttonRef}
        variant={active ? 'Primary' : 'Background'}
        fill={active ? 'Soft' : undefined}
        className={buttonClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        data-active={active ? 'true' : undefined}
        onClick={open}
      >
        <Icon size="200" src={icon} />
      </IconButton>
      <PopOut anchor={anchor} position="Bottom" align="End" offset={6} content={menu} />
    </>
  );
}
