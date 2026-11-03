import { style } from '@vanilla-extract/css';
import { config } from 'folds';

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

export const Empty = style({




  textAlign: 'center',
});

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

export const Chip = style({



  minWidth: 0,
  maxWidth: '50%',
});
