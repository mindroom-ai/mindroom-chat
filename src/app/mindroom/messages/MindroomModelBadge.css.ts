import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const Badge = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: toRem(2),
  boxSizing: 'border-box',
  // Overflow the 36px avatar by at most the 12px layout gap on either side.
  maxWidth: toRem(60),
  minHeight: toRem(14),
  padding: `0 ${toRem(4)}`,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: toRem(999),
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  fontSize: toRem(9),
  fontWeight: 550,
  lineHeight: toRem(12),
  letterSpacing: toRem(0.1),
});

export const Icon = style({
  flexShrink: 0,
});

export const Label = style({
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
});
