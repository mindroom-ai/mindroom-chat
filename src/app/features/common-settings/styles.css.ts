import { style } from '@vanilla-extract/css';
import { config } from 'folds';

// Inner spacing of the cards that group tiles on the room and space settings pages.
export const SequenceCardStyle = style({
  paddingBlock: config.space.S300,
  paddingInline: config.space.S300,
});
