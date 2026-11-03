import { style } from '@vanilla-extract/css';
import { config } from 'folds';

/** Pins the filters sheet to the bottom edge of the screen. */
export const SheetContainer = style({
  position: 'fixed',
  insetInline: 0,
  bottom: 0,
  display: 'flex',
  justifyContent: 'center',
});

export const SheetBody = style({
  display: 'flex',



});
