import { CSSProperties, ReactNode, useRef } from 'react';
import FocusTrap from 'focus-trap-react';
import { Overlay, OverlayBackdrop, OverlayCenter, toRem } from 'folds';
import { stopPropagation } from '../../lib/keyboard';

const DIALOG_WIDTH: CSSProperties = { width: `min(${toRem(420)}, calc(100vw - ${toRem(32)}))` };

type SecurityOverlayProps = {
  onClose: () => void;
  /**
   * Whether Escape closes; false while closing would lose something, such as a recovery key shown
   * once or a setup still running. Escape then goes no further than the dialog.
   */
  dismissible?: boolean;
  children: ReactNode;
};

/**
 * The modal layer for verification and key setup dialogs, above settings and every page. A click
 * outside neither closes nor is blocked, so a recovery key on screen is never lost to a stray
 * click and popovers opened from inside still work.
 */
export function SecurityOverlay({ onClose, dismissible = true, children }: SecurityOverlayProps) {
  // The trap reads its options once; the ref carries later changes.
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;
  const trap = {
    onDeactivate: onClose,
    escapeDeactivates: (event: KeyboardEvent) => stopPropagation(event) && dismissibleRef.current,
    allowOutsideClick: true,
    clickOutsideDeactivates: false,
    initialFocus: false as const,
  };
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
