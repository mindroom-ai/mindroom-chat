import { style } from '@vanilla-extract/css';
import { DefaultReset } from 'folds';

// Fills the folds Avatar it sits in; the fallback color comes from the room ID (inline vars).
export const RoomAvatar = style([
  DefaultReset,
  {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    userSelect: 'none',
  },
]);
