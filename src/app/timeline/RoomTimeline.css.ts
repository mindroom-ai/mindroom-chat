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

/** A floating pill (Jump to Latest, Jump to Unread, Mark as Read): 44 px tall to a finger. */
export const FloatingAction = style(touchTarget('4px'));

/**
 * "[+all]" reserves its touch area in layout instead of raising a layer into floating controls.
 * The inline `all: unset` requires important sizing rules.
 */
export const ExpandAllToggle = style({
  '@media': {
    '(pointer: coarse)': {
      minBlockSize: '44px !important',
      minInlineSize: '44px !important',
    },
  },
});
