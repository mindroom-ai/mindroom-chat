import { style } from '@vanilla-extract/css';
import { color, toRem } from 'folds';

// The link mark in the corner of the sidebar's Local MindRoom button.
export const LinkIndicator = style({
  boxSizing: 'border-box',
  inlineSize: toRem(18),
  blockSize: toRem(18),
  display: 'grid',
  placeItems: 'center',
  borderRadius: toRem(9),
  backgroundColor: color.Primary.Main,
  color: color.Primary.OnMain,
});
