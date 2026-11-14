import { style } from '@vanilla-extract/css';
import { config } from 'folds';

export const Marker = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
});

export const Note = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
});
