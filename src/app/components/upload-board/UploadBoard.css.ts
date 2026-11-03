import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { glassFloating, glassSurface } from '../../styles/Glass.css';

// The staged-uploads panel that floats above the composer.
















    justifyContent: 'flex-end',
  },
]);

export const UploadBoard = style([
  DefaultReset,
  glassSurface({ level: 'overlay', variant: 'Surface' }),
  glassFloating,
  {
    width: '100%',
    maxWidth: toRem(400),
    maxHeight: '50vh',
    display: 'flex',


















  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
});
