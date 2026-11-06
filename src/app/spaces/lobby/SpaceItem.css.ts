import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';
import { ENABLED_CARD_ACTION } from '../../lib/cardAction';

/**
 * A space heading in the lobby. A line under it marks a closed space (its rooms hidden) and a
 * space the user is not in.
 */
export const SpaceItemCard = recipe({
  base: {
    minWidth: 0,
    paddingBlock: config.space.S100,
    paddingInlineEnd: config.space.S100,
    borderBlockEnd: `${config.borderWidth.B300} solid transparent`,
    selectors: {
      // A space the person is not in joins from a click anywhere on its heading.
      [`&:has(${ENABLED_CARD_ACTION})`]: {
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      },
    },
  },
  variants: {
    outlined: {
      true: {
        borderBlockEndColor: color.Surface.ContainerLine,
      },
    },
  },
});

// The space name chip; its text truncates instead of pushing the controls out of the row.
export const HeaderChip = style({
  minWidth: 0,
  maxWidth: '100%',
  paddingInline: config.space.S300,
});

// Holds the line placeholder at the chip's height so the heading does not jump when it loads.
export const HeaderChipPlaceholder = style({
  display: 'flex',
  alignItems: 'center',
  minHeight: toRem(32),
  paddingInline: config.space.S300,
});
