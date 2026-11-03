import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';
import { glassFloating, glassSurface } from '../../styles/Glass.css';

// The staged-uploads panel that floats above the composer.















    display: 'flex',
    justifyContent: 'flex-end',
  },
]);

export const UploadBoard = style([
  DefaultReset,
  glassSurface({ level: 'overlay', variant: 'Surface' }),
  glassFloating,
  {
    width: '100%',
    // As wide as a folds dialog (size.DialogWidth, 23.75rem); at most half the viewport tall,
    // so the newest messages stay visible above it while files upload.
    maxWidth: config.size.DialogWidth,
    maxHeight: '50vh',
    display: 'flex',


















  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
});
