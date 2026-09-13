import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const ThreadSummaryCard = style({
  alignSelf: 'flex-start',
  width: 'fit-content',
  minWidth: 0,
  maxWidth: `min(100%, ${toRem(560)})`,
  padding: config.space.S300,
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});

export const ThreadSummaryMeta = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S200,
});

export const ThreadSummaryLabel = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  padding: `${config.space.S100} ${config.space.S200}`,
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.Secondary.ContainerLine}`,
  backgroundColor: color.Secondary.Container,
  color: color.Secondary.OnContainer,
});

export const ThreadSummaryBody = style({
  minWidth: 0,
  fontWeight: 500,
});

export const ThreadSummaryBodyCompact = style({
  minWidth: 0,
  fontWeight: 500,
});
