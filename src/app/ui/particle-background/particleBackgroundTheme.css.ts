import { createVar, globalStyle } from '@vanilla-extract/css';
import { ALL_THEME_NAMES } from '../../preferences/themeNames';
import { PARTICLE_THEMES } from './particleBackgroundTheme';

export const particleBackgroundColorVar = createVar();
export const particleBackgroundGradientVar = createVar();

// applyAppTheme() sets the theme id class on <html>: src/index.tsx applies the
// startup theme with it before the app first renders, and AppTheme every later
// theme, so these variables are correct from the first frame of the splash screen.
globalStyle(':root', {
  vars: {
    [particleBackgroundColorVar]: PARTICLE_THEMES.dark.backgroundColor,
    [particleBackgroundGradientVar]: PARTICLE_THEMES.dark.backgroundRadialGradient,
  },
  '@media': {
    '(prefers-color-scheme: light)': {
      vars: {
        [particleBackgroundColorVar]: PARTICLE_THEMES.light.backgroundColor,
        [particleBackgroundGradientVar]: PARTICLE_THEMES.light.backgroundRadialGradient,
      },
    },
  },
});

ALL_THEME_NAMES.forEach((name) => {
  const theme = PARTICLE_THEMES[name];
  globalStyle(`:root.${name}-theme`, {
    vars: {
      [particleBackgroundColorVar]: theme.backgroundColor,
      [particleBackgroundGradientVar]: theme.backgroundRadialGradient,
    },
  });
});
