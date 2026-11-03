import { style } from '@vanilla-extract/css';
import { config } from 'folds';

// Sits above the composer, as wide as it, and grows upward.

// folds Header size 400 and MenuItem size 400 are both 2.5rem tall. The menu shows the header
// and six and a half rows (plus the S100 padding above and below), so the cut-off row shows the
// list scrolls; on short screens it stops at 40% of the viewport, leaving the composer and the
// last messages visible.
const ROW = 2.5;
const MAX_MENU_HEIGHT = `min(${ROW + 6.5 * ROW + 0.5}rem, 40vh)`;
export const AutocompleteMenuBase = style({
  position: 'relative',
});

export const AutocompleteMenuContainer = style({
  position: 'absolute',
  bottom: config.space.S200,
  left: 0,
  right: 0,
  zIndex: 1,
});

export const AutocompleteMenu = style({
  display: 'flex',
  flexDirection: 'column',
  maxHeight: MAX_MENU_HEIGHT,
  width: '100%',
  overflow: 'hidden',
});

export const AutocompleteMenuHeader = style({
  paddingInline: config.space.S300,
  gap: config.space.S200,
});

export const AutocompleteMenuItems = style({
  padding: config.space.S100,
});
