import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { glassSurface } from '../../styles/Glass.css';

// A link preview card: optional image on the left, title, description and site name.
export const UrlPreview = style([
  DefaultReset,
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  {







    boxSizing: 'border-box',
  },
]);


































