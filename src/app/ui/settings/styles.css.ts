import { style } from '@vanilla-extract/css';
import { config } from 'folds';

/** Spacing for the cards that group setting tiles on every settings page. */
export const SequenceCardStyle = style({
  padding: config.space.S300,
});
