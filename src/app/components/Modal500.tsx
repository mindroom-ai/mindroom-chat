import React, { ComponentProps, ReactNode } from 'react';
import FocusTrap from 'focus-trap-react';
import { Overlay, OverlayBackdrop, OverlayCenter } from 'folds';
import { Modal } from './glass/GlassPrimitives';
import { stopPropagation } from '../utils/keyboard';

interface Modal500Props {
  /** Runs on Escape (outside a text field) and on a click outside the dialog. */
  requestClose: () => void;
  children: ReactNode;
}

type TrapOptions = NonNullable<ComponentProps<typeof FocusTrap>['focusTrapOptions']>;

/** Focus stays in the dialog; any way of leaving it (Escape, outside click) means "close". */
const closingTrap = (onClose: () => void): TrapOptions => ({
  initialFocus: false,
  returnFocusOnDeactivate: true,
  clickOutsideDeactivates: true,
  escapeDeactivates: stopPropagation,
  onDeactivate: onClose,
});

/**
 * The large centered dialog that settings and the account switcher open in. Keyboard focus is
 * held inside while it is open and goes back to where it was once it closes.
 */
export function Modal500({ requestClose, children }: Modal500Props) {
  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap focusTrapOptions={closingTrap(requestClose)}>
          <Modal variant="Background" size="500">
            {children}
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
