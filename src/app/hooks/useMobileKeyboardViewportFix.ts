import { useEffect } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { isIOS } from '../utils/user-agent';

/**
 * Mobile WebViews can leave CSS dynamic viewport units stuck at the keyboard
 * height after dismiss/resume. Keep the room shell pinned to an explicit
 * `--app-height` value and restore it from the layout viewport when native
 * keyboard hide events say the keyboard is gone.
 *
 * The room layout consumes `--app-height` on the RoomView `<Page>` as a JS-driven
 * fallback alongside `100dvh` on `html`.
 */
export function useMobileKeyboardViewportFix(): void {
  useEffect(() => {
    const nativePlatform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : undefined;
    const mobileViewportNeedsSync = isIOS() || nativePlatform === 'android';

    if (!mobileViewportNeedsSync) return undefined;

    const { visualViewport } = window;
    const rafIds = new Set<number>();
    const timeoutIds = new Set<number>();
    const keyboardHandles: PluginListenerHandle[] = [];
    let disposed = false;

    const getPositiveViewportHeight = (height: number | undefined): number | undefined =>
      typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : undefined;

    const getVisualViewportHeight = (): number | undefined =>
      getPositiveViewportHeight(window.visualViewport?.height);

    const getLayoutViewportHeight = (): number | undefined => {
      const innerHeight = getPositiveViewportHeight(window.innerHeight);
      const clientHeight = getPositiveViewportHeight(document.documentElement.clientHeight);

      if (innerHeight === undefined) return clientHeight;
      if (clientHeight === undefined) return innerHeight;
      return Math.max(innerHeight, clientHeight);
    };

    const getViewportHeight = (preferLayoutViewport: boolean): number | undefined => {
      const visualHeight = getVisualViewportHeight();
      const layoutHeight = getLayoutViewportHeight();

      if (!preferLayoutViewport) return visualHeight ?? layoutHeight;
      if (visualHeight === undefined) return layoutHeight;
      if (layoutHeight === undefined) return visualHeight;
      return Math.max(visualHeight, layoutHeight);
    };

    const updateHeight = (preferLayoutViewport = false) => {
      const rafId = requestAnimationFrame(() => {
        rafIds.delete(rafId);
        if (disposed) return;

        const viewportHeight = getViewportHeight(preferLayoutViewport);
        if (viewportHeight === undefined) return;

        document.documentElement.style.setProperty('--app-height', `${viewportHeight}px`);
        window.scrollTo(0, 0);
      });
      rafIds.add(rafId);
    };

    const scheduleRestoreHeight = () => {
      updateHeight(true);

      const timeoutId = window.setTimeout(() => {
        timeoutIds.delete(timeoutId);
        updateHeight(true);
      }, 80);
      timeoutIds.add(timeoutId);
    };

    const addKeyboardListener = (promise: Promise<PluginListenerHandle>) => {
      void promise
        .then((handle) => {
          if (disposed) {
            void handle.remove();
            return;
          }

          keyboardHandles.push(handle);
        })
        .catch(() => undefined);
    };
    const handleViewportResize = () => updateHeight();

    updateHeight();

    visualViewport?.addEventListener('resize', handleViewportResize);
    window.addEventListener('resize', handleViewportResize);
    window.addEventListener('orientationchange', scheduleRestoreHeight);
    window.addEventListener('pageshow', scheduleRestoreHeight);
    window.addEventListener('focusout', handleViewportResize);

    if (Capacitor.isPluginAvailable('Keyboard')) {
      addKeyboardListener(Keyboard.addListener('keyboardWillShow', () => updateHeight()));
      addKeyboardListener(Keyboard.addListener('keyboardDidShow', () => updateHeight()));
      addKeyboardListener(Keyboard.addListener('keyboardWillHide', scheduleRestoreHeight));
      addKeyboardListener(Keyboard.addListener('keyboardDidHide', scheduleRestoreHeight));
    }

    return () => {
      disposed = true;
      visualViewport?.removeEventListener('resize', handleViewportResize);
      window.removeEventListener('resize', handleViewportResize);
      window.removeEventListener('orientationchange', scheduleRestoreHeight);
      window.removeEventListener('pageshow', scheduleRestoreHeight);
      window.removeEventListener('focusout', handleViewportResize);
      rafIds.forEach((rafId) => cancelAnimationFrame(rafId));
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      keyboardHandles.forEach((handle) => {
        void handle.remove();
      });
      document.documentElement.style.removeProperty('--app-height');
    };
  }, []);
}
