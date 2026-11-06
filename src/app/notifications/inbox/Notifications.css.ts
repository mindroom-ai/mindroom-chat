import { style } from '@vanilla-extract/css';
import { touchTarget } from '../../ui/styles/touchTarget';

/** A filter chip: 44 px tall to a finger, and halfway into the 8 px gap to the next. */
export const FilterChip = style(touchTarget('4px'));

/**
 * A message's preview, cut at a fixed height. On a touch screen it keeps 4 px above its content
 * inside the cut, where the hit area of an activity line at its top reaches, without moving it.
 */
export const Preview = style({
  '@media': { '(pointer: coarse)': { paddingBlockStart: 4, marginBlockStart: -4 } },
});
