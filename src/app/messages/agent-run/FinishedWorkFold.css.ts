import { style } from '@vanilla-extract/css';
import { config } from 'folds';

// The Worked for row is the reasoning header's (Reasoning.css.ts), with a clock for the bulb.

/** The work as the reply showed it before it finished. */
export const Work = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  marginTop: config.space.S100,
});
