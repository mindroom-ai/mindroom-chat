import { style } from '@vanilla-extract/css';
import { config } from 'folds';

export const Transcript = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  marginBlockStart: config.space.S200,
  minWidth: 0,
});
