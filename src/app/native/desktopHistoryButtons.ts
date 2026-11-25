import { isDesktopApp } from '../lib/nativeShell';
import { isAuxiliaryWindowPath } from '../routes/pathUtils';

const MOUSE_BUTTON_BACK = 3;
const MOUSE_BUTTON_FORWARD = 4;

const isHistoryButton = (button: number): boolean =>
  button === MOUSE_BUTTON_BACK || button === MOUSE_BUTTON_FORWARD;

/**
 * Walks browser history on release of mouse side buttons 3 (Back) and 4 (Forward) in the Electron
 * main window. Press and auxclick are cancelled so Chromium does not perform a second navigation.
 */
export const walkHistoryOnMouseButtons = (target: Window): (() => void) => {
  if (!isDesktopApp() || isAuxiliaryWindowPath(target.location.pathname)) {
    return () => undefined;
  }

  const onMouseDown = (event: MouseEvent): void => {
    if (!isHistoryButton(event.button)) return;
    event.preventDefault();
  };

  const onMouseUp = (event: MouseEvent): void => {
    if (!isHistoryButton(event.button)) return;
    event.preventDefault();
    if (event.button === MOUSE_BUTTON_BACK) {
      target.history.back();
    } else {
      target.history.forward();
    }
  };

  const onAuxClick = (event: MouseEvent): void => {
    if (!isHistoryButton(event.button)) return;
    event.preventDefault();
  };

  target.addEventListener('mousedown', onMouseDown, true);
  target.addEventListener('mouseup', onMouseUp, true);
  target.addEventListener('auxclick', onAuxClick, true);

  return () => {
    target.removeEventListener('mousedown', onMouseDown, true);
    target.removeEventListener('mouseup', onMouseUp, true);
    target.removeEventListener('auxclick', onAuxClick, true);
  };
};
