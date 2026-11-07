import { applyThemeToDom, type ResolvedTheme } from './themeBootstrap';
import type { Theme, ThemeKind } from './useTheme';

const listeners = new Set<(kind: ThemeKind) => void>();

/**
 * Applies a theme to the page, marks the root element `data-theme-kind="light"` or `"dark"` so
 * CSS and code outside the theme system can follow it, then tells the subscribers.
 */
export const applyAppTheme = (theme: Theme | ResolvedTheme): void => {
  applyThemeToDom(theme);
  const kind = 'themeKind' in theme ? theme.themeKind : theme.kind;
  document.documentElement.dataset.themeKind = kind;
  listeners.forEach((listener) => listener(kind));
};

/**
 * Calls `listener` with the theme's kind each time a theme has been applied, once the document has
 * its classes and the mark (the browser may not have painted it yet); the theme context changes
 * before that. Returns the unsubscribe.
 */
export const subscribeAppliedTheme = (listener: (kind: ThemeKind) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
