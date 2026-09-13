import React, { ReactNode, useCallback, useRef } from 'react';
import FocusTrap from 'focus-trap-react';
import { Header, Menu, Scroll, config } from 'folds';

import { useAlive } from '../../hooks/useAlive';
import { preventScrollWithArrowKey, stopPropagation } from '../../utils/keyboard';
import * as css from './InviteAutocompleteMenu.css';

type InviteAutocompleteMenuProps = {
  open: boolean;
  requestClose: () => void;
  input: ReactNode;
  headerContent: ReactNode;
  menuId: string;
  menuLabel: string;
  children: ReactNode;
};

export function InviteAutocompleteMenu({
  open,
  requestClose,
  input,
  headerContent,
  menuId,
  menuLabel,
  children,
}: InviteAutocompleteMenuProps) {
  const alive = useAlive();
  const openRef = useRef(open);
  const requestCloseRef = useRef(requestClose);

  openRef.current = open;
  // FocusTrap stores callbacks; keep deactivation wired to the latest parent closure.
  requestCloseRef.current = requestClose;

  const handleDeactivate = useCallback(() => {
    if (alive() && openRef.current) {
      requestCloseRef.current();
    }
  }, [alive]);

  return (
    <FocusTrap
      active={open}
      focusTrapOptions={{
        initialFocus: false,
        onPostDeactivate: handleDeactivate,
        returnFocusOnDeactivate: false,
        clickOutsideDeactivates: true,
        allowOutsideClick: true,
        isKeyForward: () => false,
        isKeyBackward: () => false,
        escapeDeactivates: stopPropagation,
      }}
    >
      <div className={css.InviteAutocompleteMenuRoot}>
        {input}
        <div className={css.InviteAutocompleteMenuAnchor}>
          {open && (
            <div className={css.InviteAutocompleteMenuContainer}>
              <Menu
                id={menuId}
                role="listbox"
                aria-label={menuLabel}
                className={css.InviteAutocompleteMenu}
              >
                <Header className={css.InviteAutocompleteMenuHeader} size="400">
                  {headerContent}
                </Header>
                <Scroll style={{ flexGrow: 1 }} onKeyDown={preventScrollWithArrowKey}>
                  <div style={{ padding: config.space.S200 }}>{children}</div>
                </Scroll>
              </Menu>
            </div>
          )}
        </div>
      </div>
    </FocusTrap>
  );
}
