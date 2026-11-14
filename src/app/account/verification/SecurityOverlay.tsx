import { CSSProperties, ReactNode, useRef } from 'react';
import FocusTrap from 'focus-trap-react';
import { Overlay, OverlayBackdrop, OverlayCenter, toRem } from 'folds';
import { stopPropagation } from '../../lib/keyboard';

const DIALOG_WIDTH: CSSProperties = { width: `min(${toRem(420)}, calc(100vw - ${toRem(32)}))` };

type SecurityOverlayProps = {
  onClose: () => void;
  /**
   * Whether Escape or a press on the backdrop closes; false while closing would lose something,
   * such as a recovery key shown once or a setup still running. Escape then goes no further than
   * the dialog.
   */
  dismissible?: boolean;
  children: ReactNode;
};

/**
 * The modal layer for verification and key setup dialogs, above settings and every page. A press
 * on its backdrop closes like Escape does. One outside the layer, such as in a popover opened from
 * inside, neither closes nor is blocked.
 */
export function SecurityOverlay({ onClose, dismissible = true, children }: SecurityOverlayProps) {
  // The trap reads its options once; the refs carry later changes and the layer.
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;
  const layerRef = useRef<HTMLDivElement>(null);
  const trap = {
    onDeactivate: onClose,
    escapeDeactivates: (event: KeyboardEvent) => stopPropagation(event) && dismissibleRef.current,
    allowOutsideClick: true,
    clickOutsideDeactivates: (event: MouseEvent | TouchEvent) => {
      const { target } = event;
      const closes =
        dismissibleRef.current && target instanceof Node && !!layerRef.current?.contains(target);
      // Uncancelled, a tap goes on as a click to whatever lies under the backdrop once it is gone.
      if (closes) event.preventDefault();
      return closes;
    },
    initialFocus: false as const,
  };
  return (
    <Overlay ref={layerRef} backdrop={<OverlayBackdrop />} open>
      <OverlayCenter>
        <FocusTrap focusTrapOptions={trap}>
          <div style={DIALOG_WIDTH}>{children}</div>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
