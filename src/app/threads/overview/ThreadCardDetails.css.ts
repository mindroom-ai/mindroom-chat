import { style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';

export const HoverCard = style({
  maxWidth: toRem(320),
  padding: config.space.S300,
  selectors: {
    '&:not(:has([data-thread-detail]:not(:empty)))': { display: 'none' },
  },
});
