import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useSetting } from '../preferences/useSetting';
import { settingsAtom } from '../preferences/settings';
import * as palettes from './colors.css';
import { roundedRadii } from './config.css';

/** Whether a theme is a light or a dark one; picks the system default and the code colors. */
export const ThemeKind = {
  Dark: 'dark',
  Light: 'light',
} as const;
export type ThemeKind = (typeof ThemeKind)[keyof typeof ThemeKind];

export interface Theme {
  id: string;
  kind: ThemeKind;
  /**
   * Classes for `<body>`: the theme ID, its palette, the code highlighting scheme, and the corner
   * radii every theme shares.
   */
  classNames: string[];
}

/** Builds the theme `<name>-theme` on top of a palette class from `colors.css`. */
const defineTheme = (name: string, kind: ThemeKind, paletteClass: string): Theme => {
  const id = `${name}-theme`;
  const prismScheme = kind === ThemeKind.Dark ? 'prism-dark' : 'prism-light';
  return { id, kind, classNames: [id, paletteClass, prismScheme, roundedRadii] };
};

export const LightTheme = defineTheme('light', ThemeKind.Light, palettes.lightTheme);
export const SilverTheme = defineTheme('silver', ThemeKind.Light, palettes.silverTheme);
export const DarkTheme = defineTheme('dark', ThemeKind.Dark, palettes.darkTheme);
export const MidnightTheme = defineTheme('midnight', ThemeKind.Dark, palettes.midnightTheme);
export const ButterTheme = defineTheme('butter', ThemeKind.Dark, palettes.butterTheme);
export const GreenTheme = defineTheme('green', ThemeKind.Dark, palettes.greenTheme);
export const OrangeTheme = defineTheme('orange', ThemeKind.Dark, palettes.orangeTheme);

export const THEMES: Theme[] = [
  LightTheme,
  SilverTheme,
  DarkTheme,
  MidnightTheme,
  ButterTheme,
  GreenTheme,
  OrangeTheme,
];

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

/** The default light or dark theme for the system's current preference, following changes. */
export const useSystemDefaultTheme = (): Theme =>
  useSystemThemeKind() === ThemeKind.Dark ? DarkTheme : LightTheme;

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
  }, [useSystemTheme, themeId, systemKind, lightThemeId, darkThemeId]);
};

// Set by `AppTheme`; outside it, `useTheme` falls back to the settings' choice.
const ThemeContext = createContext<Theme | undefined>(undefined);

export const ThemeContextProvider = ThemeContext.Provider;

/** The theme the app shows: the provided one, or the one the settings select. */
export const useTheme = (): Theme => {
  const provided = useContext(ThemeContext);
  const active = useActiveTheme();
  return provided ?? active;
};
