import { globalStyle, style } from '@vanilla-extract/css';
import { config } from 'folds';

/** Pins the sheet to the bottom edge of the screen. */
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
  minHeight: 0,
  // Clear of the home indicator at the bottom of a phone.
  paddingBottom: `calc(${config.space.S200} + env(safe-area-inset-bottom, 0px))`,
});

// The sheet's title lines up with the content under it; its close button keeps to the corner.
globalStyle(`${SheetContainer} header`, {
  paddingInlineStart: config.space.S400,
  paddingInlineEnd: config.space.S200,
});
