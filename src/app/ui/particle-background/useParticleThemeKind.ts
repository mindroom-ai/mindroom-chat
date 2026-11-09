import { useEffect, useState } from 'react';
import type { ParticleThemeKind } from './particleBackgroundTheme';

const LIGHT_THEME_CLASSES = ['light-theme', 'silver-theme'];
const DARK_THEME_CLASSES = [
  'dark-theme',
  'midnight-theme',
  'butter-theme',
  'green-theme',
  'orange-theme',
];

export const resolveParticleThemeKind = (): ParticleThemeKind => {
  if (typeof document === 'undefined') return 'dark';

  const { classList } = document.documentElement;
  if (LIGHT_THEME_CLASSES.some((className) => classList.contains(className))) return 'light';
  if (DARK_THEME_CLASSES.some((className) => classList.contains(className))) return 'dark';

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
