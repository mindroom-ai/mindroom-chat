import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

export const Overview = style({
  margin: `0 ${config.space.S300} ${config.space.S200}`,
  padding: config.space.S200,
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  flexShrink: 0,
});

export const FilterRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S100,
});
