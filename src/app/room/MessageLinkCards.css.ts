import { style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';

// As a thread card's details (ThreadCardDetails.css.ts), read beside the link.
export const HoverCard = style({
  maxWidth: toRem(320),
  padding: config.space.S300,
});
