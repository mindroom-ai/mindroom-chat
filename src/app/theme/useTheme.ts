import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { atom, useAtomValue } from 'jotai';
import { type Settings, settingsAtom } from '../preferences/settings';
import { readCachedClientConfig } from '../config/ClientConfigLoader';
import type { ClientConfig } from '../config/useClientConfig';
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

/** The theme `config.json` names as `defaultTheme` (`"green"` for `green-theme`), if there is one. */
export const deploymentDefaultTheme = (config: ClientConfig | undefined): Theme | undefined => {
  const name: unknown = config?.defaultTheme;
  return typeof name === 'string' ? getThemeById(`${name}-theme`) : undefined;
};

type ThemeSettings = Pick<Settings, 'useSystemTheme' | 'themeId' | 'lightThemeId' | 'darkThemeId'>;

/**
 * The theme settings in effect under the deployment's default theme. Without a theme pick (no
 * fixed, light or dark theme stored) it is the fixed theme, whatever the system's preference: the
 * stored `useSystemTheme` is no choice, as every write of the settings stores it. With a pick, it
 * stands in for the unset fixed pick and for the unset pick of its own kind.
 */
export const effectiveThemeSettings = <T extends ThemeSettings>(
  settings: T,
  deploymentTheme: Theme | undefined
): T => {
  if (!deploymentTheme) return settings;
  if (!settings.themeId && !settings.lightThemeId && !settings.darkThemeId) {
    return { ...settings, useSystemTheme: false, themeId: deploymentTheme.id };
  }
  const kindPick = deploymentTheme.kind === ThemeKind.Dark ? 'darkThemeId' : 'lightThemeId';
  return {
    ...settings,
    themeId: settings.themeId ?? deploymentTheme.id,
    [kindPick]: settings[kindPick] ?? deploymentTheme.id,
  };
};

const NOT_SET = Symbol('not set');
const setDeploymentThemeAtom = atom<Theme | undefined | typeof NOT_SET>(NOT_SET);

/**
 * The deployment's default theme: from the configuration this browser loaded last until the app
 * shell sets the fresh one, so the first screens already show it.
 */
export const deploymentThemeAtom = atom(
  (get) => {
    const set = get(setDeploymentThemeAtom);
    return set === NOT_SET ? deploymentDefaultTheme(readCachedClientConfig()) : set;
  },
  (_get, set, theme: Theme | undefined) => set(setDeploymentThemeAtom, theme)
);

/** The settings with the theme settings in effect (`effectiveThemeSettings`). */
export const themeSettingsAtom = atom((get) =>
  effectiveThemeSettings(get(settingsAtom), get(deploymentThemeAtom))
);

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
 * The theme of the signed-out pages: the deployment's default theme, else the light or dark theme
 * for the system's current preference, following changes.
 */
export const useSignedOutTheme = (): Theme => {
  const systemKind = useSystemThemeKind();
  const deploymentTheme = useAtomValue(deploymentThemeAtom);
  return deploymentTheme ?? (systemKind === ThemeKind.Dark ? DarkTheme : LightTheme);
};

/**
 * The theme the settings select (with the deployment's default, `effectiveThemeSettings`): the
 * fixed theme, or with "use system theme" the light or dark theme picked for the system's current
 * preference.
 */
const useActiveTheme = (): Theme => {
  const systemKind = useSystemThemeKind();
  const { themeId, useSystemTheme, lightThemeId, darkThemeId } = useAtomValue(themeSettingsAtom);

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
