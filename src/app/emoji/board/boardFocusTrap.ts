import type { ComponentProps } from 'react';
import type FocusTrap from 'focus-trap-react';
import { stopPropagation } from '../../lib/keyboard';

type TrapOptions = NonNullable<ComponentProps<typeof FocusTrap>['focusTrapOptions']>;

/**
 * Options of the focus trap around the board, and around its Retry view when the board could not
 * load (LazyEmojiBoard.tsx): leaving the trap closes the board.
 */
export const makeTrapOptions = (close: () => void, returnFocus?: boolean): TrapOptions => ({
  initialFocus: false,
  clickOutsideDeactivates: true,
  returnFocusOnDeactivate: returnFocus,
  // Escape closes the board, also from the search field (see stopPropagation in lib/keyboard).
  escapeDeactivates: stopPropagation,
  onDeactivate: close,
});

/**
 * The same for the board's Retry view (LazyEmojiBoard.tsx), which closes on Escape and on a click
 * outside but not when it goes: a Retry that loads the board replaces the view, and the board
 * stays open.
 */
export const makeRetryViewTrapOptions = (
  close: () => void,
  returnFocus?: boolean
): TrapOptions => ({
  ...makeTrapOptions(close, returnFocus),
  onDeactivate: undefined,
  escapeDeactivates: (event) => {
    const closes = stopPropagation(event);
    if (closes) close();
    return closes;
  },
  clickOutsideDeactivates: () => {
    close();
    return true;
  },
});
