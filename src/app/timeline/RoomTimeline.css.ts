import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { config } from 'folds';
import { touchTarget } from '../ui/styles/touchTarget';

/** A control that hovers over the timeline, centered at its top or bottom edge. */
export const TimelineFloat = recipe({
  base: {
    position: 'absolute',
    insetInline: 0,
    marginInline: 'auto',
    width: 'max-content',
    maxWidth: `calc(100% - ${config.space.S400} * 2)`,
    zIndex: 2,
    display: 'flex',
    gap: config.space.S200,
    pointerEvents: 'auto',
  },
  variants: {
    position: {
      Top: { top: config.space.S300 },
      Bottom: { bottom: config.space.S400 },
    },
  },
  defaultVariants: { position: 'Top' },
});

const expandAllTouchTarget = style(touchTarget('22px'));

/**
 * "[+all]", 18 px of text with nothing beside it: 44 px tall to a finger. Its hit area reaches into
 * the top of the row below, which paints later, so on a touch screen it is lifted above the rows
 * (important, since the button's inline `all: unset` resets z-index).
 */
export const ExpandAllToggle = style([
  expandAllTouchTarget,
  { '@media': { '(pointer: coarse)': { zIndex: '1 !important' } } },
]);
