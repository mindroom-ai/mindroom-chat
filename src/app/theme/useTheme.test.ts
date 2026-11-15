import { describe, expect, it } from 'vitest';
import { roundedRadii } from './config.css';
import type { ClientConfig } from '../config/useClientConfig';
import {
  GreenTheme,
  SilverTheme,
  THEMES,
  deploymentDefaultTheme,
  effectiveThemeSettings,
  withSystemTheme,
} from './useTheme';

describe('THEMES', () => {
  it('gives every theme the shared corner radii, which go on <body> beside folds config', () => {
    for (const theme of THEMES) {
      expect(theme.classNames).toContain(roundedRadii);
    }
  });

  it('keeps each theme its own ID, palette and code scheme classes', () => {
    for (const theme of THEMES) {
      expect(theme.classNames[0]).toBe(theme.id);
      expect(theme.classNames).toContain(theme.kind === 'dark' ? 'prism-dark' : 'prism-light');
    }
    expect(new Set(THEMES.map((theme) => theme.classNames[1])).size).toBe(THEMES.length);
  });
});

describe('deploymentDefaultTheme', () => {
  it('finds the theme config.json names, and nothing for another value', () => {
    expect(deploymentDefaultTheme({ defaultTheme: 'green' })).toBe(GreenTheme);
    expect(deploymentDefaultTheme({ defaultTheme: 'green-theme' })).toBeUndefined();
    expect(deploymentDefaultTheme({ defaultTheme: 7 } as unknown as ClientConfig)).toBeUndefined();
    expect(deploymentDefaultTheme({})).toBeUndefined();
    expect(deploymentDefaultTheme(undefined)).toBeUndefined();
  });
});

describe('effectiveThemeSettings', () => {
  const unpicked = { useSystemTheme: true };

  it('keeps the settings without a deployment default', () => {
    expect(effectiveThemeSettings(unpicked, undefined)).toBe(unpicked);
  });

  it('shows the default as the fixed theme until a theme is picked', () => {
    expect(effectiveThemeSettings(unpicked, GreenTheme)).toEqual({
      useSystemTheme: false,
      themeId: GreenTheme.id,
    });
  });

  it('keeps the picks and fills the unset fixed pick and the pick of its kind', () => {
    expect(
      effectiveThemeSettings({ useSystemTheme: true, lightThemeId: 'silver-theme' }, GreenTheme)
    ).toEqual({
      useSystemTheme: true,
      themeId: GreenTheme.id,
      lightThemeId: 'silver-theme',
      darkThemeId: GreenTheme.id,
    });
    expect(
      effectiveThemeSettings({ useSystemTheme: false, themeId: 'dark-theme' }, SilverTheme)
    ).toEqual({ useSystemTheme: false, themeId: 'dark-theme', lightThemeId: SilverTheme.id });
  });
});

describe('withSystemTheme', () => {
  const dark = THEMES.find((theme) => theme.kind === 'dark');

  it('turned on, makes the deployment theme the pick of its kind when none is stored', () => {
    expect(withSystemTheme({ useSystemTheme: false }, dark, true)).toEqual({
      useSystemTheme: true,
      darkThemeId: dark?.id,
    });
  });

  it('turned on, keeps a stored pick of the deployment theme kind', () => {
    expect(
      withSystemTheme({ useSystemTheme: false, darkThemeId: 'green-theme' }, dark, true)
    ).toEqual({ useSystemTheme: true, darkThemeId: 'green-theme' });
  });

  it('turned off, or without a deployment theme, changes only the switch', () => {
    expect(withSystemTheme({ useSystemTheme: true }, dark, false)).toEqual({
      useSystemTheme: false,
    });
    expect(withSystemTheme({ useSystemTheme: false }, undefined, true)).toEqual({
      useSystemTheme: true,
    });
  });
});
