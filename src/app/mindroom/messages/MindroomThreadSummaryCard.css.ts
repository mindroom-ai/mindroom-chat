import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const ThreadSummaryCard = style({
  alignSelf: 'flex-start',
  width: 'fit-content',
  minWidth: 0,
  maxWidth: `min(100%, ${toRem(420)})`,
  padding: config.space.S200,
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});

export const ThreadSummaryHeader = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S100,
});

export const ThreadSummaryLabel = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  width: 'fit-content',
  minHeight: toRem(24),
  padding: `0 ${config.space.S200}`,
  borderRadius: config.radii.Pill,
  border: `${config.borderWidth.B300} solid ${color.Secondary.ContainerLine}`,
  backgroundColor: color.Secondary.Container,
  color: color.Secondary.Main,
});

export const ThreadSummaryBody = style({
  minWidth: 0,
  margin: 0,
  fontSize: toRem(15),
  fontWeight: 500,
  lineHeight: toRem(22),
});

export const ThreadSummaryBodyCompact = style({
  minWidth: 0,
  margin: 0,
  fontSize: toRem(15),
  fontWeight: 500,
  lineHeight: toRem(22),
});
