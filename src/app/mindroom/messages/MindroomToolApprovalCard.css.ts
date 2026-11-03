import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/** An `io.mindroom.tool_approval` request rendered in the timeline. */
export const Card = style({
  minWidth: 0,
  maxWidth: `min(100%, ${toRem(520)})`,





});

/** Relative request time, set off from the metadata before it by a dot. */
export const MetaDot = style({
  opacity: 0.7,
  selectors: {
    '&::before': {
      content: '"·"',
      marginInline: config.space.S100,
    },
  },
});

/** Explains what a timed auto-approval would cover. */
export const Scope = style({



});
