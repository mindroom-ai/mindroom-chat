import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';






});

export const LinePlaceholder = style({
  width: '100%',
  height: toRem(12),
  borderRadius: config.radii.R300,
  backgroundColor: color.SurfaceVariant.Container,
});
