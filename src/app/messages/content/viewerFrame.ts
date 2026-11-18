import type { CSSProperties } from 'react';
import type FocusTrap from 'focus-trap-react';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { stopPropagation } from '../../lib/keyboard';
import { PhoneModal, PhoneOverlayCenter } from '../../ui/Modal500.css';

// Attachment viewers (image, text, PDF) get most of the window, past the modal's usual size cap.
const WINDOW_BOX: CSSProperties = {
  width: '90vw',
  height: '90vh',
  maxWidth: 'none',
  maxHeight: 'none',
};

type ViewerFrame = {
  /** For the `OverlayCenter` around the viewer. */
  centerClassName?: string;
  /** For the `Modal` that holds the viewer. */
  modalClassName?: string;
  modalStyle?: CSSProperties;
};

/**
 * The size of an attachment viewer's modal for the current screen. On phones a viewer is a screen
 * of its own, like the large dialogs (Modal500): edge to edge, without the glass rim, and its
 * header kept clear of the notch and the home indicator.
 */
export const useViewerFrame = (): ViewerFrame =>
  useScreenSizeContext() === ScreenSize.Mobile
    ? { centerClassName: PhoneOverlayCenter, modalClassName: PhoneModal }
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
