import { desktopBridge } from '../lib/nativeShell';

/**
 * Runs `onHidden` whenever the Electron main window is hidden (close-to-hide on macOS).
 */
export const watchDesktopWindowHidden = (onHidden: () => void): (() => void) => {
  const bridge = desktopBridge();
  if (!bridge) return () => undefined;
  return bridge.onShellEvent((event) => {
    if (event.type === 'window-hidden') {
      onHidden();
    }
  });
};
