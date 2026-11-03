import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';
import { glassOutline, glassSurface } from '../../styles/Glass.css';

// One file in the upload board: icon, name and actions on top, progress or error below.
export const UploadCard = recipe({
  base: [
    DefaultReset,
    glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
    {
      display: 'flex',








    outlined: {
      true: glassOutline,
    },
    // Settings forms place a single upload in a narrow column, so it sits tighter there.











  display: 'flex',
  alignItems: 'flex-start',
  gap: config.space.S100,
  color: color.Critical.Main,
  minWidth: 0,
  overflowWrap: 'anywhere',
});

// A square thumbnail for an image upload, in the place of its file-type icon.
export const UploadCardPreview = style({
  flexShrink: 0,
  inlineSize: toRem(36),
  blockSize: toRem(36),
  objectFit: 'cover',
  borderRadius: config.radii.R300,
});
