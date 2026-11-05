import { CSSProperties, ReactNode } from 'react';
import FocusTrap from 'focus-trap-react';
import { Overlay, OverlayBackdrop, OverlayCenter, toRem } from 'folds';
import { stopPropagation } from '../../lib/keyboard';

const DIALOG_WIDTH: CSSProperties = { width: `min(${toRem(420)}, calc(100vw - ${toRem(32)}))` };

/**
 * Escape closes; a click outside neither closes nor is blocked, so a recovery key on screen is
 * never lost to a stray click and popovers opened from inside still work.
 */
const escapeOnly = (onClose: () => void) => ({
  onDeactivate: onClose,
  escapeDeactivates: stopPropagation,
  allowOutsideClick: true,
  clickOutsideDeactivates: false,
  initialFocus: false as const,
});

type SecurityOverlayProps = {
  onClose: () => void;
  children: ReactNode;
};

/** The modal layer for verification and key setup dialogs, above settings and every page. */
export function SecurityOverlay({ onClose, children }: SecurityOverlayProps) {
  const trap = escapeOnly(onClose);
  return (
    <Overlay backdrop={<OverlayBackdrop />} open>
      <OverlayCenter>
        <FocusTrap focusTrapOptions={trap}>
          <div style={DIALOG_WIDTH}>{children}</div>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
