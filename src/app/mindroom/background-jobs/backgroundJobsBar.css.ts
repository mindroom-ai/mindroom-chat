import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { glassFloating, glassSurface } from '../../styles/Glass.css';

export const Bar = style([
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  glassFloating,
  {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '8px 12px',
    margin: `0 ${config.space.S400} ${config.space.S200}`,
    borderRadius: config.radii.R400,
    color: color.SurfaceVariant.OnContainer,
    flexShrink: 0,
  },
]);

export const Status = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
});

export const Items = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
});

export const Item = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  padding: '2px 4px 2px 10px',
  borderRadius: 16,
  border: `1px solid ${color.Surface.ContainerLine}`,
  background: color.SurfaceVariant.Container,
  fontSize: 12,
  whiteSpace: 'nowrap',
});

export const Chip = style({
  border: `1px solid ${color.Surface.ContainerLine}`,
  borderRadius: 16,
  background: color.SurfaceVariant.Container,
  color: 'inherit',
  padding: '5px 10px',
  cursor: 'pointer',
  fontSize: 12,
  whiteSpace: 'nowrap',
});
