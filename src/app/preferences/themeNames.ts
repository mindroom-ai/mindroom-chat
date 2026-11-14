/**
 * The app's themes by kind, in the order Settings offers them. A theme's ID, which is also the
 * class the document carries while the theme shows, is `<name>-theme`; `theme/colors.css.ts` holds
 * each one's palette.
 */
export const LIGHT_THEME_NAMES = ['light', 'silver'] as const;
export const DARK_THEME_NAMES = ['dark', 'midnight', 'butter', 'green', 'orange'] as const;

export type ThemeName = (typeof LIGHT_THEME_NAMES)[number] | (typeof DARK_THEME_NAMES)[number];

const carriesOneOf = (names: readonly ThemeName[]): string =>
  `:is(${names.map((name) => `.${name}-theme`).join(', ')})`;

/** Selects an element that carries a light theme's ID class. */
export const LIGHT_THEMES = carriesOneOf(LIGHT_THEME_NAMES);
/** Selects an element that carries a dark theme's ID class. */
export const DARK_THEMES = carriesOneOf(DARK_THEME_NAMES);
