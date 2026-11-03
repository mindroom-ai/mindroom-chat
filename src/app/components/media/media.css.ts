import { style } from '@vanilla-extract/css';
import { DefaultReset } from 'folds';

// Both elements fill the message box they sit in; the box sets the size and aspect ratio.
const coverBox = {
  display: 'block',
  width: '100%',
  height: '100%',
} as const;

/** Cropped to the box, like a thumbnail; the viewer shows the whole image. */
export const Image = style([DefaultReset, coverBox, { objectFit: 'cover' }]);

/** Letterboxed instead of cropped: a player must show the whole frame. */
export const Video = style([DefaultReset, coverBox, { objectFit: 'contain' }]);
