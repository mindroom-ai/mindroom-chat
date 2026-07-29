import { useEffect } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { isIOS } from '../utils/user-agent';

const APP_HEIGHT = '--app-height';
const APP_VIEWPORT_OFFSET_TOP = '--app-viewport-offset-top';

/**
 * iOS Safari never shrinks the layout viewport for the software keyboard, and
 * `100dvh` tracks the layout viewport. So in a standalone PWA the shell ends up
 * one keyboard-height taller than what is on screen, and WebKit pans the visual
 * viewport down over it to reveal the focused composer — leaving app background
 * between the composer and the keyboard (CINNY-132).
 *
 * Publish the visible window as two custom properties so `#root` can be pinned
 * to it as a fixed follower (see `src/index.css`):
 *
 *   --app-height              visualViewport.height
 *   --app-viewport-offset-top visualViewport.offsetTop
 *
 * The pan is a visual-viewport *scroll*, not a resize — a user drag fires no
 * resize at all — so both events must be observed.
 *
 * The hook still runs inside the Capacitor wrapper, because that is iOS too.
 * There `Keyboard.resize: 'native'` already resizes the WebView, so it
 * publishes `innerHeight` and `0` — pixel values, not the CSS fallbacks, but
 * geometrically the identity case.
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

    const getViewportOffsetTop = (): number => {
      const offsetTop = window.visualViewport?.offsetTop;
      if (typeof offsetTop !== 'number' || !Number.isFinite(offsetTop) || offsetTop <= 0) return 0;
      return offsetTop;
    };

    const updateViewport = (preferLayoutViewport = false) => {
      const rafId = requestAnimationFrame(() => {
        rafIds.delete(rafId);
        if (disposed) return;

        const viewportHeight = getViewportHeight(preferLayoutViewport);
        if (viewportHeight !== undefined) {
          document.documentElement.style.setProperty(APP_HEIGHT, `${viewportHeight}px`);
        }

        // Restoring after a keyboard hide means the pan is gone by definition;
        // reading offsetTop mid-animation would re-pin the shell to a stale pan.
        const offsetTop = preferLayoutViewport ? 0 : getViewportOffsetTop();
        document.documentElement.style.setProperty(APP_VIEWPORT_OFFSET_TOP, `${offsetTop}px`);
      });
      rafIds.add(rafId);
    };

    // Both settle paths write twice, because the viewport metrics that follow
    // these events are not final when the event fires.
    const scheduleViewportSettle = (preferLayoutViewport: boolean) => {
      updateViewport(preferLayoutViewport);

      const timeoutId = window.setTimeout(() => {
        timeoutIds.delete(timeoutId);
        updateViewport(preferLayoutViewport);
      }, 80);
      timeoutIds.add(timeoutId);
    };

    // A native keyboard-hide event does prove the pan is gone, so prefer the
    // layout viewport over a visual viewport still mid-dismiss-animation.
    const restoreAfterKeyboardHide = () => scheduleViewportSettle(true);

    // Rotation and bfcache restore prove nothing of the sort: the keyboard can
    // still be open across both. Forcing the layout viewport there would write
    // exactly the pre-fix geometry — full layout height, zero offset — and the
    // delayed second write would clobber any correct visualViewport event in
    // between. Re-measure on the same delay, but from what is actually there.
    const remeasureAfterViewportSettle = () => scheduleViewportSettle(false);

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
    const handleViewportChange = () => updateViewport();

    updateViewport();

    visualViewport?.addEventListener('resize', handleViewportChange);
    visualViewport?.addEventListener('scroll', handleViewportChange);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', remeasureAfterViewportSettle);
    window.addEventListener('pageshow', remeasureAfterViewportSettle);
    window.addEventListener('focusout', handleViewportChange);

    if (Capacitor.isPluginAvailable('Keyboard')) {
      addKeyboardListener(Keyboard.addListener('keyboardWillShow', () => updateViewport()));
      addKeyboardListener(Keyboard.addListener('keyboardDidShow', () => updateViewport()));
      addKeyboardListener(Keyboard.addListener('keyboardWillHide', restoreAfterKeyboardHide));
      addKeyboardListener(Keyboard.addListener('keyboardDidHide', restoreAfterKeyboardHide));
    }

    return () => {
      disposed = true;
      visualViewport?.removeEventListener('resize', handleViewportChange);
      visualViewport?.removeEventListener('scroll', handleViewportChange);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('orientationchange', remeasureAfterViewportSettle);
      window.removeEventListener('pageshow', remeasureAfterViewportSettle);
      window.removeEventListener('focusout', handleViewportChange);
      rafIds.forEach((rafId) => cancelAnimationFrame(rafId));
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      keyboardHandles.forEach((handle) => {
        void handle.remove();
      });
      document.documentElement.style.removeProperty(APP_HEIGHT);
      document.documentElement.style.removeProperty(APP_VIEWPORT_OFFSET_TOP);
    };
  }, []);
}
