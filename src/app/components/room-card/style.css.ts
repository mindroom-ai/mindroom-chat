import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { glassSurface } from '../../styles/Glass.css';

// Cards for rooms and spaces in Explore and the lobby, laid out in a responsive grid.
export const CardGrid = style({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fill, minmax(${toRem(240)}, 1fr))`,
  gap: config.space.S400,
});

export const RoomCardBase = style([
  DefaultReset,
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  {





    gap: config.space.S500,












  border: 'none',
  padding: 0,
  textAlign: 'start',










  minWidth: toRem(96),
});
