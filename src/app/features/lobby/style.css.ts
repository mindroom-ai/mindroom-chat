import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/** Stands in for a room avatar while the room's summary loads; the Avatar sizes it. */
export const AvatarPlaceholder = style({
  inlineSize: '100%',
  blockSize: '100%',
  backgroundColor: color.SurfaceVariant.ContainerActive,
  borderRadius: config.radii.R400,
});

export const LinePlaceholder = style({
  width: '100%',
  height: toRem(12),
  borderRadius: config.radii.R300,
  backgroundColor: color.SurfaceVariant.Container,
});
