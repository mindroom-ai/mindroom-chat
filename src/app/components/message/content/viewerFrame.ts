import type { CSSProperties } from 'react';
import type FocusTrap from 'focus-trap-react';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { stopPropagation } from '../../../utils/keyboard';

// Attachment viewers (image, text, PDF) get most of the window, past the modal's usual size cap.
const WINDOW_BOX: CSSProperties = {
  width: '90vw',
  height: '90vh',
  maxWidth: 'none',
  maxHeight: 'none',
};

// On phones a viewer is a screen of its own, like the large dialogs (Modal500): edge to edge,
// square corners, and its header kept clear of the notch and the home indicator.
const PHONE_BOX: CSSProperties = {
  width: '100%',
  height: '100%',
  maxWidth: 'none',
  maxHeight: 'none',
  borderRadius: 0,
  border: 'none',
  paddingTop: 'env(safe-area-inset-top, 0px)',
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  paddingLeft: 'env(safe-area-inset-left, 0px)',
  paddingRight: 'env(safe-area-inset-right, 0px)',
};

const PHONE_CENTER: CSSProperties = {
  padding: 0,
  alignItems: 'stretch',
  justifyContent: 'stretch',
};

export type ViewerFrame = {
  /** For the `OverlayCenter` around the viewer. */
  centerStyle?: CSSProperties;
  /** For the `Modal` that holds the viewer. */
  modalStyle: CSSProperties;
};

/** The size of an attachment viewer's modal for the current screen. */
export const useViewerFrame = (): ViewerFrame =>
  useScreenSizeContext() === ScreenSize.Mobile
    ? { centerStyle: PHONE_CENTER, modalStyle: PHONE_BOX }
    : { modalStyle: WINDOW_BOX };

type TrapOptions = NonNullable<FocusTrap.Props['focusTrapOptions']>;

// Escape closes the viewer and goes no further; so does a click outside it.
const DISMISSIBLE = { clickOutsideDeactivates: true, escapeDeactivates: stopPropagation };

/** Focus trap options for a viewer that closes however focus leaves it. */
export const viewerTrapOptions = (close: () => void): TrapOptions => ({
  ...DISMISSIBLE,
  initialFocus: false,
  onDeactivate: close,
});
