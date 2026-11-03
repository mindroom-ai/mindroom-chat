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
  flexDirection: 'column',
  gap: config.space.S400,
  padding: `${config.space.S300} ${config.space.S400}`,
  // Clear of the home indicator at the bottom of a phone.
  paddingBottom: `calc(${config.space.S400} + env(safe-area-inset-bottom, 0px))`,
});
