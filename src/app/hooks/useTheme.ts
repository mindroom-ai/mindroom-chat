import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { butterTheme, darkTheme, lightTheme, midnightTheme, silverTheme } from '../../colors.css';
import { settingsAtom } from '../state/settings';
import { useSetting } from '../state/hooks/settings';





























};

export const MidnightTheme: Theme = {
  id: 'midnight-theme',
  kind: ThemeKind.Dark,







};

export const THEMES: Theme[] = [LightTheme, SilverTheme, DarkTheme, MidnightTheme, ButterTheme];

const getThemeById = (themeId: string | undefined): Theme | undefined =>
  THEMES.find((theme) => theme.id === themeId);

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

const readSystemThemeKind = (): ThemeKind =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(DARK_SCHEME_QUERY).matches
    ? ThemeKind.Dark
    : ThemeKind.Light;

/** The operating system's light or dark preference, following changes. */
const useSystemThemeKind = (): ThemeKind => {
  const [kind, setKind] = useState(readSystemThemeKind);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(DARK_SCHEME_QUERY);
    const handleChange = () => setKind(readSystemThemeKind());
    handleChange();
    query.addEventListener?.('change', handleChange);
    return () => query.removeEventListener?.('change', handleChange);
  }, []);

  return kind;
};

/**
 * The theme the settings select: the fixed theme, or with "use system theme" the light or dark
 * theme picked for the system's current preference.
 */
const useActiveTheme = (): Theme => {
  const systemKind = useSystemThemeKind();
  const [themeId] = useSetting(settingsAtom, 'themeId');
  const [useSystemTheme] = useSetting(settingsAtom, 'useSystemTheme');
  const [lightThemeId] = useSetting(settingsAtom, 'lightThemeId');
  const [darkThemeId] = useSetting(settingsAtom, 'darkThemeId');

  return useMemo(() => {
    if (!useSystemTheme) return getThemeById(themeId) ?? LightTheme;
    return systemKind === ThemeKind.Dark
      ? getThemeById(darkThemeId) ?? DarkTheme
      : getThemeById(lightThemeId) ?? LightTheme;










  const active = useActiveTheme();
  return provided ?? active;
};
