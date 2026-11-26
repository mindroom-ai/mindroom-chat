import { focusManager } from '@tanstack/react-query';
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

/**
 * Integrates Electron's `window-focus` shell events with TanStack Query's `focusManager`
 * alongside `visibilitychange` so app-switch returns refetch stale queries.
 */
export const watchDesktopQueryFocus = (): (() => void) => {
  const bridge = desktopBridge();
  if (!bridge || typeof window === 'undefined') return () => undefined;

  focusManager.setEventListener((handleFocus) => {
    let lastFocused = document.visibilityState !== 'hidden' && bridge.isWindowFocused();
    if (!lastFocused) handleFocus(false);

    const update = (next: boolean): void => {
      if (next === lastFocused) return;
      lastFocused = next;
      handleFocus(next);
    };

    const onVisibilityChange = (): void => {
      update(document.visibilityState !== 'hidden' && bridge.isWindowFocused());
    };

    window.addEventListener('visibilitychange', onVisibilityChange);
    const stopShellEvents = bridge.onShellEvent((event) => {
      if (event.type === 'window-focus') {
        update(event.focused && document.visibilityState !== 'hidden');
      }
    });

    return () => {
      window.removeEventListener('visibilitychange', onVisibilityChange);
      stopShellEvents();
    };
  });

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    focusManager.setEventListener((handleFocus) => {
      if (typeof window === 'undefined') return undefined;
      const onVisibilityChange = () => handleFocus();
      window.addEventListener('visibilitychange', onVisibilityChange);
      return () => window.removeEventListener('visibilitychange', onVisibilityChange);
    });
    focusManager.setFocused(undefined);
  };
};
