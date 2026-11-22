import { style } from '@vanilla-extract/css';

/** Keeps a long model name or raw value from pushing the tile's title off narrow viewports. */
export const TriggerButton = style({
  maxInlineSize: 'min(15rem, 55vw)',
});
