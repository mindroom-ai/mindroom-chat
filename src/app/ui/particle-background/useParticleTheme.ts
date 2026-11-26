import { useEffect, useState } from 'react';
import { ALL_THEME_NAMES, type ThemeName } from '../../preferences/themeNames';

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

export const resolveParticleThemeName = (): ThemeName => {
  if (typeof document === 'undefined') return 'dark';

  const { classList } = document.documentElement;
  const activeTheme = ALL_THEME_NAMES.find((name) => classList.contains(`${name}-theme`));
  if (activeTheme) return activeTheme;

  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(DARK_SCHEME_QUERY).matches;
  return prefersDark ? 'dark' : 'light';
};

/**
 * The active theme name, read from the theme id class on <html> that the particle
 * CSS variables follow too.
 */
export const useParticleThemeName = (): ThemeName => {
  const [themeName, setThemeName] = useState<ThemeName>(resolveParticleThemeName);

  useEffect(() => {
    const syncTheme = () => setThemeName(resolveParticleThemeName());
    // Catch a theme class or scheme change that landed between initial render and effect.
    syncTheme();

    let observer: MutationObserver | undefined;
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      observer = new MutationObserver(syncTheme);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }

    const mediaQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(DARK_SCHEME_QUERY)
        : undefined;
    mediaQuery?.addEventListener?.('change', syncTheme);

    return () => {
      observer?.disconnect();
      mediaQuery?.removeEventListener?.('change', syncTheme);
    };
  }, []);

  return themeName;
};
