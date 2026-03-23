import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

export const Overview = style({
  margin: `0 ${config.space.S300} ${config.space.S200}`,
  padding: config.space.S200,
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  flexShrink: 0,
  maxHeight: 'min(18vh, 12rem)',
  overflowY: 'auto',
});

export const FilterRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S100,
});

export const ThreadList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
});

export const ThreadRow = style({
  padding: config.space.S200,
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
});

export const ThreadRowResolved = style({
  borderColor: color.Success.ContainerLine,
  backgroundColor: color.Success.Container,
  color: color.Success.OnContainer,
});

export const ThreadPreview = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const ActionRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: config.space.S100,
});
