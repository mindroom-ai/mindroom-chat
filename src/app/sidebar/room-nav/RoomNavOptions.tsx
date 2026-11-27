import React, { useEffect, useRef } from 'react';
import { Icon, IconButton, Icons, type RectCords } from 'folds';
import { FocusTrap } from 'focus-trap-react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { RoomActionsMenu } from '../../room/RoomActionsMenu';
import type { RoomActionDialog } from '../../room/roomActions';
import { PopOut } from '../../ui/directional';
import { NavItemOptions } from '../../ui/nav/NavItem';

export type RoomNavOptionsProps = {
  room: Room;
  spaceId?: string;
  removeFromSpaceId?: string;
  /** Shown while the row is hovered, holds focus or has its menu open; hidden, it stays mounted. */
  shown: boolean;
  anchor: RectCords | undefined;
  onAnchorChange: (anchor: RectCords | undefined) => void;
  showDialog: (dialog: RoomActionDialog) => void;
};

/** Hover/focus/context `⋮` options button and portaled menu for a sidebar room row. */
export function RoomNavOptions({
  room,
  spaceId,
  removeFromSpaceId,
  shown,
  anchor,
  onAnchorChange,
  showDialog,
}: RoomNavOptionsProps) {
  const { t } = useTranslation();
  const menuOpen = anchor !== undefined;
  const closeMenu = () => onAnchorChange(undefined);
  const anchorToButton = (event: React.MouseEvent<HTMLButtonElement>) =>
    onAnchorChange(event.currentTarget.getBoundingClientRect());

  // The button keeps focus while a pointer opened its menu, and a row that can be dragged keeps its
  // buttons' keys from the page, where the menu's focus trap listens for Escape: Escape on the
  // button is heard here first.
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const button = buttonRef.current;
    if (!menuOpen || !button) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event.target === button) onAnchorChange(undefined);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [menuOpen, onAnchorChange]);

  const menu = (
    <FocusTrap
      focusTrapOptions={{
        initialFocus: false,
        clickOutsideDeactivates: true,
        returnFocusOnDeactivate: false,
        onDeactivate: closeMenu,
      }}
    >
      <RoomActionsMenu
        room={room}
        spaceId={spaceId}
        removeFromSpaceId={removeFromSpaceId}
        submenuSide="Right"
        close={closeMenu}
        showDialog={showDialog}
      />
    </FocusTrap>
  );

  return (
    <NavItemOptions shown={shown}>
      <PopOut anchor={anchor} offset={4} position="Right" align="Start" content={menu}>
        <IconButton
          ref={buttonRef}
          variant="Background"
          fill="None"
          size="300"
          radii="300"
          aria-label={t('featureUi.roomNav.roomNavItem.moreOptions')}
          aria-pressed={menuOpen}
          onClick={anchorToButton}
        >
          <Icon size="50" src={Icons.VerticalDots} />
        </IconButton>
      </PopOut>
    </NavItemOptions>
  );
}
