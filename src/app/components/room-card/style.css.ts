import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { glassSurface } from '../../styles/Glass.css';

// Cards for rooms and spaces in Explore and the lobby, laid out in a responsive grid.
export const CardGrid = style({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fill, minmax(${toRem(240)}, 1fr))`,
  gap: config.space.S400,
});

// A card is a column: avatar row, name and topic, then the member count and the action.
export const RoomCardBase = style([
  DefaultReset,
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  {
    display: 'flex',





    gap: config.space.S500,
  },
]);

// The topic is a bare button that opens the full text; on the card it is cut at three lines.
export const RoomCardTopic = style({
  border: 'none',
  padding: 0,
  textAlign: 'start',
  margin: 0,
  background: 'none',











  minWidth: toRem(96),
});
