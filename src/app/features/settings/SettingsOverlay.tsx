import { ReactNode } from 'react';
import FocusTrap from 'focus-trap-react';
import { Overlay, OverlayBackdrop, OverlayCenter } from 'folds';
import { stopPropagation } from '../../utils/keyboard';

/** Escape (kept from the settings dialog underneath), Tab out or a click outside dismiss it. */
const dismissingTrap = (onDismiss: () => void) => ({
  onDeactivate: onDismiss,
  escapeDeactivates: stopPropagation,
  clickOutsideDeactivates: true,
  initialFocus: false as const,
});

type SettingsOverlayProps = {
  onDismiss: () => void;
  children: ReactNode;
};

/** A dialog over the settings dialog: confirmations and authentication prompts. */
export function SettingsOverlay({ onDismiss, children }: SettingsOverlayProps) {
  const backdrop = <OverlayBackdrop />;
  return (
    <Overlay backdrop={backdrop} open>
      <OverlayCenter>
        <FocusTrap focusTrapOptions={dismissingTrap(onDismiss)}>
          <div>{children}</div>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
