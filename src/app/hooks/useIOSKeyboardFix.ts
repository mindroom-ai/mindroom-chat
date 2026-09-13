import { useEffect } from 'react';
import { isIOS } from '../utils/user-agent';

/**
 * iOS Safari doesn't properly recalculate viewport/scroll state after virtual
 * keyboard dismissal, leaving a stale scroll offset that creates white space
 * below content. This hook resets the scroll position when it detects the
 * keyboard has been dismissed (viewport height increases or input loses focus).
 *
 * The viewport meta tag `interactive-widget=resizes-content` in index.html is
 * a complementary measure: as of March 2026 WebKit has not shipped support for
 * it (see WebKit bug 259770), so this JS hook must work standalone.
 */
export function useIOSKeyboardFix(): void {
  useEffect(() => {
    if (!isIOS()) return undefined;

    let lastViewportHeight = window.visualViewport?.height ?? window.innerHeight;
    let focusOutTimerId: ReturnType<typeof setTimeout> | undefined;

    const handleViewportResize = () => {
      const currentHeight = window.visualViewport?.height ?? window.innerHeight;
      // Viewport grew = keyboard dismissed
      if (currentHeight > lastViewportHeight && window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
      lastViewportHeight = currentHeight;
    };

    const handleFocusOut = (event: FocusEvent) => {
      // If focus is moving to another element, keyboard isn't dismissing
      if (event.relatedTarget instanceof HTMLElement) return;

      // Small delay to let iOS finish its animation
      if (focusOutTimerId !== undefined) clearTimeout(focusOutTimerId);
      focusOutTimerId = setTimeout(() => {
        if (window.scrollY !== 0) {
          window.scrollTo(0, 0);
        }
        focusOutTimerId = undefined;
      }, 100);
    };

    window.visualViewport?.addEventListener('resize', handleViewportResize);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      if (focusOutTimerId !== undefined) clearTimeout(focusOutTimerId);
      window.visualViewport?.removeEventListener('resize', handleViewportResize);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);
}
