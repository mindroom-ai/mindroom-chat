import React, { PropsWithChildren, ReactNode, useCallback } from 'react';
import FocusTrap from 'focus-trap-react';
import isHotkey from 'is-hotkey';
import { Header, Menu } from '../../glass/GlassPrimitives';
import { PageScroll } from '../../page';
import { useAlive } from '../../../hooks/useAlive';
import { preventScrollWithArrowKey, stopPropagation } from '../../../utils/keyboard';
import * as css from './AutocompleteMenu.css';

type AutocompleteMenuProps = PropsWithChildren<{
  /** Closes the menu: Escape, a click outside, or after an item was picked. */
  requestClose: () => void;
  headerContent: ReactNode;
}>;

type TrapOptions = NonNullable<React.ComponentProps<typeof FocusTrap>['focusTrapOptions']>;

// Arrow keys step through the items like Tab does; the trap wraps at both ends.
const isArrowDown = (evt: KeyboardEvent) => isHotkey('arrowdown', evt);
const isArrowUp = (evt: KeyboardEvent) => isHotkey('arrowup', evt);

/**
 * Floating list of suggestions above the composer. Arrow keys move between the items (wrapping
 * at the ends), Escape or a click outside closes it.
 */
export function AutocompleteMenu({ requestClose, headerContent, children }: AutocompleteMenuProps) {
  const alive = useAlive();
  const closeIfMounted = useCallback(() => {
    if (alive()) requestClose();
  }, [alive, requestClose]);

  const trapOptions: TrapOptions = {
    // A click in the composer closes the menu without stealing the caret from the text box.
    clickOutsideDeactivates: true,
    escapeDeactivates: stopPropagation,
    returnFocusOnDeactivate: false,
    initialFocus: false,
    isKeyForward: isArrowDown,
    isKeyBackward: isArrowUp,
    onPostDeactivate: closeIfMounted,
  };
  const heading = (
    <Header size="400" className={css.AutocompleteMenuHeader}>
      {headerContent}
    </Header>
  );
  const menu = (
    <FocusTrap focusTrapOptions={trapOptions}>
      <Menu className={css.AutocompleteMenu}>
        <PageScroll header={heading} onKeyDown={preventScrollWithArrowKey} scrollbarTabIndex={-1}>
          <div className={css.AutocompleteMenuItems}>{children}</div>
        </PageScroll>
      </Menu>
    </FocusTrap>
  );

  return (
    <div className={css.AutocompleteMenuBase}>
      <div className={css.AutocompleteMenuContainer}>{menu}</div>
    </div>
  );
}
