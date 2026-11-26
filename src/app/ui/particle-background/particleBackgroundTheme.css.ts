import { createVar, globalStyle } from '@vanilla-extract/css';
import { ALL_THEME_NAMES, DARK_THEMES, LIGHT_THEMES } from '../../preferences/themeNames';
import { PARTICLE_THEMES } from './particleBackgroundTheme';

export const particleBackgroundColorVar = createVar();
export const particleColorVar = createVar();
export const particleGlowPercentVar = createVar();

// applyAppTheme() sets the theme id class on <html>: src/index.tsx applies the
// startup theme with it before the app first renders, and AppTheme every later
// theme, so these variables are correct from the first frame of the splash screen.
globalStyle(':root', {
  vars: {
    [particleBackgroundColorVar]: PARTICLE_THEMES.dark.backgroundColor,
    [particleColorVar]: PARTICLE_THEMES.dark.particleColor,
    [particleGlowPercentVar]: '18%',
  },
  '@media': {
    '(prefers-color-scheme: light)': {
      vars: {
        [particleBackgroundColorVar]: PARTICLE_THEMES.light.backgroundColor,
        [particleColorVar]: PARTICLE_THEMES.light.particleColor,
        [particleGlowPercentVar]: '16%',
      },
    },
  },
});

globalStyle(`:root${DARK_THEMES}`, {
  vars: { [particleGlowPercentVar]: '18%' },
});

globalStyle(`:root${LIGHT_THEMES}`, {
  vars: { [particleGlowPercentVar]: '16%' },
});

ALL_THEME_NAMES.forEach((name) => {
  const theme = PARTICLE_THEMES[name];
  globalStyle(`:root.${name}-theme`, {
    vars: {
      [particleBackgroundColorVar]: theme.backgroundColor,
      [particleColorVar]: theme.particleColor,
    },
  });
});
