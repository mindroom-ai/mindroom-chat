import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { glassSurface } from '../../ui/styles/Glass.css';

// Cards for rooms and spaces in Explore and the lobby, laid out in a responsive grid.
export const CardGrid = style({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fill, minmax(${toRem(240)}, 1fr))`,
  gap: config.space.S400,
});

// Children stack top to bottom, and the card may shrink below the width of its content.
const stacked = style({
  display: 'flex',
  flexFlow: 'column',
  gap: config.space.S500,
  minWidth: 0,
  padding: config.space.S400,
});

// A card is a column: avatar row, name and topic, then the member count and the action.
export const RoomCardBase = style([
  DefaultReset,
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  stacked,
  {
    color: color.SurfaceVariant.OnContainer,
    borderRadius: config.radii.R500,
  },
]);

/** A button with none of the browser's button look; it reads as plain, clickable text. */
const plainButton = style({
  margin: 0,
  padding: 0,
  border: 'none',
  background: 'none',
  color: 'inherit',
  textAlign: 'start',
  cursor: 'pointer',
});

/** Cuts text off with an ellipsis after `lines` lines. */
const clampLines = (lines: number) =>
  ({
    display: '-webkit-box',
    overflow: 'hidden',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: lines,
  } as const);

// The topic is a bare button that opens the full text; on the card it is cut at three lines.
export const RoomCardTopic = style([plainButton, clampLines(3)]);

// Join, View and retry keep a readable width next to the member count.
export const ActionButton = style({
  flexShrink: 0,
  minWidth: toRem(96),
});
