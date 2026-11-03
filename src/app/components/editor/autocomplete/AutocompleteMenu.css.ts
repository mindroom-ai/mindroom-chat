import { style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';

// Sits above the composer, as wide as it, and grows upward to at most a third of the screen.
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
  maxHeight: `min(${toRem(400)}, 30vh)`,
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
