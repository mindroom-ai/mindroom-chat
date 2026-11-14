import { useEffect, useState } from 'react';
import { DARK_THEME_NAMES, LIGHT_THEME_NAMES } from '../../preferences/themeNames';
import type { ParticleThemeKind } from './particleBackgroundTheme';

export const resolveParticleThemeKind = (): ParticleThemeKind => {
  if (typeof document === 'undefined') return 'dark';

  const { classList } = document.documentElement;
  const showsOneOf = (names: readonly string[]) =>
    names.some((name) => classList.contains(`${name}-theme`));
  if (showsOneOf(LIGHT_THEME_NAMES)) return 'light';
  if (showsOneOf(DARK_THEME_NAMES)) return 'dark';

  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
};

/**
 * The active theme kind, read from the theme id class on <html> that the particle
 * CSS variables follow too.
 */
export const useParticleThemeKind = (): ParticleThemeKind => {
  const [themeKind, setThemeKind] = useState<ParticleThemeKind>(resolveParticleThemeKind);

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;

    // Catch a theme class change that landed between initial render and effect.
    setThemeKind(resolveParticleThemeKind());

    const observer = new MutationObserver(() => {
      setThemeKind(resolveParticleThemeKind());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  return themeKind;
};
