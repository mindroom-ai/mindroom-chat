import { describe, expect, it } from 'vitest';
import { roundedRadii } from './config.css';
import type { ClientConfig } from '../config/useClientConfig';
import {
  GreenTheme,
  SilverTheme,
  THEMES,
  deploymentDefaultTheme,
  effectiveThemeSettings,
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
