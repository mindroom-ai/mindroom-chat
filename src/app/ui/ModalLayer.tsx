import {
  type ComponentProps,
  type ReactNode,
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
} from 'react';
import FocusTrap from 'focus-trap-react';
import { Overlay, OverlayBackdrop, OverlayCenter } from 'folds';

type TrapOptions = NonNullable<ComponentProps<typeof FocusTrap>['focusTrapOptions']>;

/** Where focus goes as the layer opens and closes; focus-trap's defaults apply to what is left out. */
export type ModalLayerFocus = Pick<
  TrapOptions,
  'initialFocus' | 'fallbackFocus' | 'returnFocusOnDeactivate' | 'setReturnFocus'
>;

type ModalLayerProps = {
  /** Defaults to open; a closed layer renders nothing. */
  open?: boolean;
  /** Runs once when Escape or a click outside the dialog dismisses it. */
  onClose: () => void;
  /** While a request runs, Escape and outside clicks leave the dialog open. */
  busy?: boolean;
  focus?: ModalLayerFocus;
  /** The dialog surface. */
  children: ReactNode;
};

/**
 * Given by a pop-out, such as a message's menu, whose entries open their dialogs from inside it:
 * a dialog calls it as it opens and calls what it returns as it closes. The pop-out hides
 * meanwhile, so it does not stay open behind the dialog.
 */
export const DialogOpenerContext = createContext<(() => () => void) | undefined>(undefined);

/**
 * The dimmed, centered layer a small modal dialog sits in. Keyboard focus stays inside while it is
 * open, and Escape or a click outside closes it unless it is busy.
 */
export function ModalLayer({
  open = true,
  onClose,
  busy = false,
  focus,
  children,
}: ModalLayerProps) {
  // focus-trap reads its options once, when the layer opens; the handlers read the latest props.
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };
  // Before the first paint, so the opener is never seen behind the dialog.
  const hideOpener = useContext(DialogOpenerContext);
  useLayoutEffect(() => (open ? hideOpener?.() : undefined), [open, hideOpener]);
  const dismiss = (): boolean => {
    if (latest.current.busy) return false;
    latest.current.onClose();
    return true;
  };
  return (
    <Overlay open={open} backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            ...focus,
            escapeDeactivates: dismiss,
            clickOutsideDeactivates: dismiss,
          }}
        >
          {children}
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
