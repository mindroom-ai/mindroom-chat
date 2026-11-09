import { readFileSync } from 'node:fs';
import chroma from 'chroma-js';
import { describe, expect, it } from 'vitest';
import {
  CODE_TOKEN_TYPES,
  DARK_CODE_TOKEN_COLORS,
  LIGHT_CODE_TOKEN_COLORS,
  type CodeTokenColors,
} from './codeTokenPalette';

const colorsSource = readFileSync(new URL('./colors.css.ts', import.meta.url), 'utf8');

/** Each palette's code block background (SurfaceVariant.Container), by palette name. */
const codeBackgrounds = (): Map<string, string> => {
  const backgrounds = new Map<string, string>();
  const palettes = colorsSource.matchAll(
    /const (\w+)Palette: Palette = \{[\s\S]*?SurfaceVariant: \{\s*Container: '(#[\da-f]{6})'/gi
  );
  [...palettes].forEach(([, name = '', background = '']) => backgrounds.set(name, background));
  return backgrounds;
};

const LIGHT_PALETTES = ['light', 'silver'];
const DARK_PALETTES = ['dark', 'midnight', 'butter', 'green', 'orange'];

const expectReadable = (colors: CodeTokenColors, background: string, palette: string) => {
  Object.entries(colors).forEach(([role, value]) => {
    expect(chroma.contrast(value, background), `${role} on ${palette}`).toBeGreaterThanOrEqual(4.5);
  });
};

describe('code token palette', () => {
  it('reads every palette background from colors.css.ts', () => {
    expect([...codeBackgrounds().keys()].sort()).toEqual(
      [...LIGHT_PALETTES, ...DARK_PALETTES].sort()
    );
  });

  it('keeps every light token readable on the light code backgrounds', () => {
    const backgrounds = codeBackgrounds();
    LIGHT_PALETTES.forEach((name) =>
      expectReadable(LIGHT_CODE_TOKEN_COLORS, backgrounds.get(name) ?? '', name)
    );
  });

  it('keeps every dark token readable on the dark code backgrounds', () => {
    const backgrounds = codeBackgrounds();
    DARK_PALETTES.forEach((name) =>
      expectReadable(DARK_CODE_TOKEN_COLORS, backgrounds.get(name) ?? '', name)
    );
  });

  it('gives each Prism token type one role', () => {
    const types = Object.values(CODE_TOKEN_TYPES).flat();
    expect(new Set(types).size).toBe(types.length);
  });
});
