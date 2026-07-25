import chroma from 'chroma-js';
import { describe, expect, it } from 'vitest';
import { scrollbarTrackColors } from '../theme/scrollbarTrackColors';
import { SCROLLBAR_THUMB_OPACITY, scrollbarThumbColors } from './scrollbarTheme';

const thumbByTheme = {
  light: scrollbarThumbColors.light,
  silver: scrollbarThumbColors.light,
  dark: scrollbarThumbColors.dark,
  midnight: scrollbarThumbColors.dark,
  butter: scrollbarThumbColors.butter,
} as const;

const composite = (foreground: string, background: string): string => {
  const [foregroundRed, foregroundGreen, foregroundBlue, alpha] = chroma(foreground).rgba();
  const [backgroundRed, backgroundGreen, backgroundBlue] = chroma(background).rgb();

  return chroma(
    foregroundRed * alpha + backgroundRed * (1 - alpha),
    foregroundGreen * alpha + backgroundGreen * (1 - alpha),
    foregroundBlue * alpha + backgroundBlue * (1 - alpha)
  ).hex();
};

describe('scrollbar theme', () => {
  it('keeps every theme and folds variant above the non-text contrast threshold', () => {
    Object.entries(scrollbarTrackColors).forEach(([theme, tracks]) => {
      const thumb = thumbByTheme[theme as keyof typeof thumbByTheme];

      expect(chroma(thumb).alpha()).toBeCloseTo(SCROLLBAR_THUMB_OPACITY, 2);
      Object.entries(tracks).forEach(([variant, track]) => {
        const renderedThumb = composite(thumb, track);

        expect(chroma.contrast(renderedThumb, track), `${theme}.${variant}`).toBeGreaterThanOrEqual(
          3
        );
      });
    });
  });
});
