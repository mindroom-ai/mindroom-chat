import { applyThemeToDom, type ResolvedTheme } from './themeBootstrap';
import { notifyAppliedTheme, subscribeAppliedTheme } from './appliedThemeListeners';
import type { Theme } from './useTheme';

/**
 * Applies a theme to the page, marks the root element `data-theme-kind="light"` or `"dark"` so
 * CSS and code outside the theme system can follow it, then tells the subscribers.
 */
export const applyAppTheme = (theme: Theme | ResolvedTheme): void => {
  applyThemeToDom(theme);
  const kind = 'themeKind' in theme ? theme.themeKind : theme.kind;
  document.documentElement.dataset.themeKind = kind;
  notifyAppliedTheme(kind);
};

export { subscribeAppliedTheme };
