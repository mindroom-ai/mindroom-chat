import { globalStyle, style } from '@vanilla-extract/css';
import { config } from 'folds';
import { FloatingShell } from '../../ui/page/floatingCards.css';
import { Bar } from './FilterBar.css';

// In a floating card the filter bar spans the card, whose border already frames it: its glass rim
// would draw a second edge beside the card's.
globalStyle(`${FloatingShell} ${Bar}${Bar}::before`, { display: 'none' });

export const View = style({
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  minHeight: 0,
});

export const Count = style({
  padding: `${config.space.S200} ${config.space.S400}`,
});

export const Scroll = style({
  flexGrow: 1,
  minHeight: 0,
  overflowY: 'auto',
});

export const List = style({
  position: 'relative',
  width: '100%',
});

/** Centers the children of a flex container on both axes. */
const CenterChildren = style({
  justifyContent: 'center',
  alignItems: 'center',
});

export const Empty = style([
  CenterChildren,
  {
    flexGrow: 1,
    padding: `${config.space.S700} ${config.space.S400}`,
    textAlign: 'center',
  },
]);

export const Row = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  padding: `${config.space.S100} ${config.space.S400}`,
});

export const RowChrome = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
});

// A row of inline content that may shrink, capped at half the row it sits in.
export const Chip = style([
  RowChrome,
  {
    display: 'inline-flex',
    maxWidth: '50%',
  },
]);
