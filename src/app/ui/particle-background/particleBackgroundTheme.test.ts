import { readFileSync } from 'node:fs';
import chroma from 'chroma-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_THEME_NAMES, LIGHT_THEME_NAMES } from '../../preferences/themeNames';
import { pageColors, primaryColors } from '../../theme/colors.css';
import { PARTICLE_THEMES } from './particleBackgroundTheme';
import { resolveParticleThemeName } from './useParticleTheme';

const colorsSource = readFileSync(new URL('../../theme/colors.css.ts', import.meta.url), 'utf8');
const LIGHT_SET = new Set<string>(LIGHT_THEME_NAMES);

/** Each palette's page text color (Background.OnContainer), by palette name. */
const backgroundTextColors = (): Map<string, string> => {
  const colors = new Map<string, string>();
  const palettes = colorsSource.matchAll(
    /const (\w+)Palette: Palette = \{[\s\S]*?Background: \{[^}]*?OnContainer: '(#[\da-f]{6})'/gi
  );
  [...palettes].forEach(([, name = '', onContainer = '']) => colors.set(name, onContainer));
  return colors;
};

describe('particle background themes', () => {
  it('maps every theme to its page and primary colors with a matching radial gradient', () => {
    expect(Object.keys(PARTICLE_THEMES).sort()).toEqual([...ALL_THEME_NAMES].sort());

    ALL_THEME_NAMES.forEach((name) => {
      const theme = PARTICLE_THEMES[name];
      const backgroundColor = pageColors[name];
      const particleColor = primaryColors[name];
      expect(theme.backgroundColor, `${name} background`).toBe(backgroundColor);
      expect(theme.particleColor, `${name} particle`).toBe(particleColor);

      const bgRgb = chroma(backgroundColor).rgb().join(', ');
      const particleRgb = chroma(particleColor).rgb().join(', ');
      const glowAlpha = LIGHT_SET.has(name) ? 0.16 : 0.18;
      expect(theme.backgroundRadialGradient, `${name} gradient`).toBe(
        `radial-gradient(circle at 50% 45%, rgba(${particleRgb}, ${glowAlpha}), rgba(${bgRgb}, 0.12) 30%, rgba(${bgRgb}, 1) 72%)`
      );
    });
  });

  it('keeps text and particles legible against every theme backdrop', () => {
    const onBackgrounds = backgroundTextColors();
    expect([...onBackgrounds.keys()].sort()).toEqual([...ALL_THEME_NAMES].sort());

    ALL_THEME_NAMES.forEach((name) => {
      const { backgroundColor, particleColor } = PARTICLE_THEMES[name];
      const onBackground = onBackgrounds.get(name) ?? '';
      expect(
        chroma.contrast(onBackground, backgroundColor),
        `Background.OnContainer on ${name}`
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        chroma.contrast(particleColor, backgroundColor),
        `particleColor on ${name}`
      ).toBeGreaterThanOrEqual(4.0);
    });
  });
});

describe('resolveParticleThemeName', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubDocumentClasses = (classes: readonly string[]) =>
    vi.stubGlobal('document', {
      documentElement: { classList: { contains: (name: string) => classes.includes(name) } },
    });

  it('resolves explicit light and dark theme classes from html', () => {
    stubDocumentClasses(['sakura-theme']);
    expect(resolveParticleThemeName()).toBe('sakura');

    stubDocumentClasses(['tokyoNight-theme']);
    expect(resolveParticleThemeName()).toBe('tokyoNight');
  });

  it('falls back to system color scheme without a theme class, and dark without DOM', () => {
    expect(resolveParticleThemeName()).toBe('dark');

    stubDocumentClasses([]);
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    expect(resolveParticleThemeName()).toBe('dark');

    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(resolveParticleThemeName()).toBe('light');
  });
});
