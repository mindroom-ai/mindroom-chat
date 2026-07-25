import { createGlobalTheme, createGlobalThemeContract } from '@vanilla-extract/css';
import { scrollbarThumbColors } from './scrollbarTheme';

export const scrollbarTheme = createGlobalThemeContract(
  {
    thumb: null,
  },
  () => 'mr-scrollbar-thumb-color'
);

createGlobalTheme(':root', scrollbarTheme, {
  thumb: scrollbarThumbColors.light,
});

createGlobalTheme(':root.dark-theme, :root.midnight-theme', scrollbarTheme, {
  thumb: scrollbarThumbColors.dark,
});

createGlobalTheme(':root.butter-theme', scrollbarTheme, {
  thumb: scrollbarThumbColors.butter,
});
