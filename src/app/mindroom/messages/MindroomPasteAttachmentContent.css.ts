import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const Card = style({
  display: 'inline-flex',
  flexDirection: 'column',
  gap: config.space.S100,
  maxWidth: 'min(100%, 28rem)',
  padding: config.space.S200,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  borderRadius: config.radii.R300,
  boxSizing: 'border-box',
});

export const Outlined = style({
  boxShadow: `inset 0 0 0 ${config.borderWidth.B300} ${color.SurfaceVariant.ContainerLine}`,
});

export const Header = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: config.space.S200,
  minWidth: 0,
});

export const Title = style({
  fontWeight: config.fontWeight.W600,
});

export const Meta = style({
  opacity: 0.72,
});

export const FileName = style({
  flex: '1 1 auto',
  minWidth: toRem(120),
  maxWidth: toRem(220),
  opacity: 0.72,
});

export const Details = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S200,
  minWidth: 0,
});

export const Actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S200,
});

globalStyle(`${Actions} > button`, {
  width: 'auto',
});
