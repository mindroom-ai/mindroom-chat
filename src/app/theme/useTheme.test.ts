import { describe, expect, it } from 'vitest';
import { roundedRadii } from './config.css';
import { THEMES } from './useTheme';

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
