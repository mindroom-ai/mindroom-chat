import { globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset } from 'folds';
import { DARK_THEMES } from '../preferences/themeNames';
import {
  AVATAR_INK_PROPERTY,
  AVATAR_SWATCHES,
  AVATAR_SWATCH_INKS,
  avatarSwatchProperty,
} from './avatarSwatches';

// Fills the folds Avatar it sits in; the fallback color comes from the ID (inline vars).
export const UserAvatar = style([
  DefaultReset,
  {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    userSelect: 'none',
  },
]);

// The fallback palette (avatarSwatches.ts). Light values apply everywhere; the dark
// themes (src/app/theme/useTheme.ts) put theirs on <body>.
const swatchVars = (kind: 'light' | 'dark'): Record<string, string> => {
  const vars: Record<string, string> = { [AVATAR_INK_PROPERTY]: AVATAR_SWATCH_INKS[kind] };
  AVATAR_SWATCHES.forEach((swatch, index) => {
    vars[avatarSwatchProperty(index)] = swatch[kind];
  });
  return vars;
};

globalStyle(':root', { vars: swatchVars('light') });
globalStyle(DARK_THEMES, { vars: swatchVars('dark') });
