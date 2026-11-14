import { createVar, globalStyle } from '@vanilla-extract/css';
import { LIGHT_THEMES } from '../../preferences/themeNames';
import { DARK_PARTICLE_THEME, LIGHT_PARTICLE_THEME } from './particleBackgroundTheme';

export const particleBackgroundColorVar = createVar();
export const particleBackgroundGradientVar = createVar();
export const particleCardBackgroundVar = createVar();
export const particleCardTextVar = createVar();
export const particleCardHighlightVar = createVar();
export const particleCardBorderVar = createVar();

// applyAppTheme() sets the theme id class on <html>: src/index.tsx applies the
// startup theme with it before the app first renders, and AppTheme every later
// theme, so these variables are correct from the first frame of the splash screen.
globalStyle(':root', {
  vars: {
    [particleBackgroundColorVar]: DARK_PARTICLE_THEME.backgroundColor,
    [particleBackgroundGradientVar]: DARK_PARTICLE_THEME.backgroundRadialGradient,
    [particleCardBackgroundVar]: DARK_PARTICLE_THEME.cardBackground,
    [particleCardTextVar]: DARK_PARTICLE_THEME.cardText,
    [particleCardHighlightVar]: DARK_PARTICLE_THEME.cardHighlight,
    [particleCardBorderVar]: DARK_PARTICLE_THEME.cardBorder,
  },
});

globalStyle(`:root${LIGHT_THEMES}`, {
  vars: {
    [particleBackgroundColorVar]: LIGHT_PARTICLE_THEME.backgroundColor,
    [particleBackgroundGradientVar]: LIGHT_PARTICLE_THEME.backgroundRadialGradient,
    [particleCardBackgroundVar]: LIGHT_PARTICLE_THEME.cardBackground,
    [particleCardTextVar]: LIGHT_PARTICLE_THEME.cardText,
    [particleCardHighlightVar]: LIGHT_PARTICLE_THEME.cardHighlight,
    [particleCardBorderVar]: LIGHT_PARTICLE_THEME.cardBorder,
  },
});
