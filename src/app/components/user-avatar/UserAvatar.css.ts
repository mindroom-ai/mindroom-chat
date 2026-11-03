import { style } from '@vanilla-extract/css';
import { DefaultReset } from 'folds';

// Fills the folds Avatar it sits in; the fallback color comes from the user ID (inline vars).
export const UserAvatar = style([
  DefaultReset,
  {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    userSelect: 'none',
  },
]);
