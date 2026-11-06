import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';
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

/** "[+all]": 16 px of text in a 1 px rim, 18 px tall, as thread-light.png shows it. */
const expandAllPillHeight = `calc(${toRem(16)} + 2px)`;

/**
 * The button is the hit area and a layer behind its text paints the pill, so a touch screen
 * reserves a 44 px target in layout, below the pill, instead of raising a layer into the row below
 * or the floating controls. The button's inline `all: unset` requires important sizes.
 */
export const ExpandAllToggle = style({
  selectors: {
    '&::before': {
      content: '""',
      position: 'absolute',
      zIndex: -1,
      insetBlockStart: -1,
      insetInline: -1,
      blockSize: expandAllPillHeight,
      boxSizing: 'border-box',
      borderRadius: config.radii.Pill,
      border: `1px solid ${color.SurfaceVariant.ContainerLine}`,
      backgroundColor: `color-mix(in srgb, ${color.Surface.Container} 72%, transparent)`,
      pointerEvents: 'none',
    },
  },
  '@media': {
    '(pointer: coarse)': {
      paddingBlockEnd: `calc(44px - ${expandAllPillHeight}) !important`,
      minInlineSize: '44px !important',
    },
  },
});
