import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';
import { ContainerColor } from '../../styles/ContainerColor.css';

export const CardGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: config.space.S400,
});

export const RoomCardBase = style([
  DefaultReset,
  ContainerColor({ variant: 'Surface' }),
  {
    padding: config.space.S500,
    borderRadius: config.radii.R500,
    border: `1px solid ${color.Surface.ContainerLine}`,
    boxShadow: config.shadow.E100,
  },
]);

export const RoomCardTopic = style({
  minHeight: `calc(3 * ${config.lineHeight.T200})`,
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  cursor: 'pointer',

  ':hover': {
    textDecoration: 'underline',
  },
});

export const ActionButton = style({
  flex: '1 1 0',
  minWidth: 1,
});
