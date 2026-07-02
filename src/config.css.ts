import { createTheme } from '@vanilla-extract/css';
import { color, config } from 'folds';

// Modernized corner radii (folds defaults: 4px/8px/12px feel dated).
export const roundedRadii = createTheme(config.radii, {
  R0: '0',
  R300: '0.5rem',
  R400: '0.75rem',
  R500: '1.125rem',
  Round: '50%',
  Pill: '9999px',
});

// Softer, larger diffuse shadows than folds defaults (0 1px 6px / 0 1px 12px).
export const softShadow = createTheme(config.shadow, {
  E100: `0px 2px 8px -2px ${color.Other.Shadow}`,
  E200: `0px 4px 16px -4px ${color.Other.Shadow}`,
  E300: `0px 8px 24px -6px ${color.Other.Shadow}`,
  E400: `0px 12px 36px -8px ${color.Other.Shadow}`,
});

export const onLightFontWeight = createTheme(config.fontWeight, {
  W100: '100',
  W200: '200',
  W300: '300',
  W400: '400',
  W500: '500',
  W600: '600',
  W700: '700',
  W800: '800',
  W900: '900',
});

export const onDarkFontWeight = createTheme(config.fontWeight, {
  W100: '100',
  W200: '200',
  W300: '300',
  W400: '400',
  W500: '500',
  W600: '600',
  W700: '700',
  W800: '800',
  W900: '900',
});
