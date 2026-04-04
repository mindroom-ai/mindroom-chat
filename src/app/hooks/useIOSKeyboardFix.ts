import { useEffect } from 'react';
import { isIOS } from '../utils/user-agent';

/**
 * iOS Safari doesn't resize the viewport when the virtual keyboard opens/closes.
 * This hook listens to `visualViewport.resize` events and sets a `--app-height`
 * CSS custom property on the document element so the layout tracks the actual
 * visible area. It also resets scroll offset drift caused by iOS keyboard
 * animations.
 *
 * The CSS in index.css consumes `--app-height` on `#root` as a JS-driven
 * fallback alongside `100dvh` on `html` (Safari 15.4+).
 */
export function useIOSKeyboardFix(): void {
  useEffect(() => {
    if (!isIOS()) return undefined;

    const { visualViewport } = window;
    if (!visualViewport) return undefined;

    let rafId: number | undefined;

    const updateHeight = () => {
      rafId = requestAnimationFrame(() => {
        rafId = undefined;
        document.documentElement.style.setProperty(
          '--app-height',
          `${visualViewport.height}px`
        );
        window.scrollTo(0, 0);
      });
    };

    // Set initial value
    updateHeight();

    visualViewport.addEventListener('resize', updateHeight);

    return () => {
      visualViewport.removeEventListener('resize', updateHeight);
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      document.documentElement.style.removeProperty('--app-height');
    };
  }, []);
}
