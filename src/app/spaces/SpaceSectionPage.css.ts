import { style } from '@vanilla-extract/css';

export const Stage = style({
  position: 'relative',
  display: 'flex',
  flex: '1 1 0',
  minInlineSize: 0,
  minBlockSize: 0,
});

export const ActiveLayer = style({
  display: 'flex',
  flex: '1 1 0',
  minInlineSize: 0,
  minBlockSize: 0,
});

export const ParkedUnderLayer = style({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  minInlineSize: 0,
  minBlockSize: 0,
  pointerEvents: 'none',
  zIndex: 0,
});
