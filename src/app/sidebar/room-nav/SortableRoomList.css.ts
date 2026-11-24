import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';

const line = {
  content: '',
  position: 'absolute',
  insetInline: config.space.S200,
  blockSize: toRem(2),
  borderRadius: config.radii.Pill,
  backgroundColor: color.Primary.Main,
  pointerEvents: 'none',
  zIndex: 1,
} as const;

/**
 * A room row, with a line on the edge where a dragged room would land. The dragged row itself
 * stays above the line and its neighbours while it follows the pointer.
 */
export const RoomDropHint = recipe({
  base: { position: 'relative' },
  variants: {
    at: {
      none: {},
      above: { selectors: { '&::before': { ...line, top: `calc(-1 * ${toRem(1)})` } } },
      below: { selectors: { '&::before': { ...line, bottom: `calc(-1 * ${toRem(1)})` } } },
    },
    dragged: { true: { zIndex: 2 }, false: {} },
  },
  defaultVariants: { at: 'none', dragged: false },
});

/**
 * Highlights a sidebar room section (`NavCategory`) while an eligible room from another section is
 * dragged over it.
 */
export const SectionDropTarget = style({
  borderRadius: config.radii.R500,
  transition: 'background-color 120ms ease-out, box-shadow 120ms ease-out',
  selectors: {
    '&[data-section-drop-target="true"]': {
      backgroundColor: `color-mix(in srgb, ${color.Primary.Container} 55%, transparent)`,
      boxShadow: `inset 0 0 0 ${config.borderWidth.B600} ${color.Primary.Main}`,
    },
  },
  '@media': {
    '(prefers-reduced-motion: reduce)': { transition: 'none' },
  },
});
