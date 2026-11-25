import type { ThemeKind } from './useTheme';

const listeners = new Set<(kind: ThemeKind) => void>();

/** Notifies subscribers after a theme has been applied to the document. */
export const notifyAppliedTheme = (kind: ThemeKind): void => {
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
