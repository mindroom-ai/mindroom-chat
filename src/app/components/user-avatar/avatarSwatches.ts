// The avatar palette for `solid` fallbacks: eight calm hues, saturated on light themes with white
// ink, and pale on dark themes with near-black ink. UserAvatar.css.ts publishes them as CSS custom
// properties per theme; components only refer to the property names, so they need no stylesheet.

/** Fill of each swatch on light themes, then on dark ones. */
export const AVATAR_SWATCHES: ReadonlyArray<{ light: string; dark: string }> = [
  { light: '#3569AF', dark: '#9FC7FE' }, // blue
  { light: '#1F7A7A', dark: '#8ED6D2' }, // teal
  { light: '#2E7D4F', dark: '#9AD7AE' }, // green
  { light: '#6A4FC4', dark: '#C4B5F7' }, // violet
  { light: '#9A3F84', dark: '#EBA9DA' }, // plum
  { light: '#B8433F', dark: '#F2A7A2' }, // brick
  { light: '#A25E12', dark: '#F2C38D' }, // amber
  { light: '#4E5D78', dark: '#B7C2D8' }, // slate
];

export const AVATAR_SWATCH_COUNT = AVATAR_SWATCHES.length;

/** Ink on every swatch, per theme kind. */
export const AVATAR_SWATCH_INKS = { light: '#FFFFFF', dark: '#15151A' } as const;

/** Custom property names, without `var()`. */
export const avatarSwatchProperty = (index: number): string => `--mr-avatar-swatch-${index}`;
export const AVATAR_INK_PROPERTY = '--mr-avatar-swatch-ink';

/** The CSS value of swatch `index`, for an inline style. */
export const avatarSwatchVar = (index: number): string => `var(${avatarSwatchProperty(index)})`;
export const AVATAR_SWATCH_INK = `var(${AVATAR_INK_PROPERTY})`;
