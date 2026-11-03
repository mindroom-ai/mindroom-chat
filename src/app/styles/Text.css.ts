import { style } from '@vanilla-extract/css';

/** Lets long words, URLs and IDs wrap instead of overflowing their container. */
export const BreakWord = style({
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
});
