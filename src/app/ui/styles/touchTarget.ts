import type { StyleRule } from '@vanilla-extract/css';

/** The smallest hit area a finger gets, as the platform guidelines put it. */
const MIN_TARGET = '44px';

/**
 * Grows a small control's hit area to 44 px on a touch screen without changing how it looks: an
 * invisible layer over the control reaches out until the area is 44 px tall and 44 px wide. Along
 * the inline axis it reaches out at most `inlineReach` on each side, half the gap to the next
 * control, so two neighbours never share a point. A control that is already larger keeps its
 * own size. `within` limits it to controls inside an ancestor matching that selector.
 */
export const touchTarget = (inlineReach: string, within = ''): StyleRule => ({
  '@media': {
    '(pointer: coarse)': {
      selectors: {
        [`${within}&&`]: { position: 'relative' },
        [`${within}&&::after`]: {
          content: '""',
          position: 'absolute',
          insetBlock: `min(0px, calc((100% - ${MIN_TARGET}) / 2))`,
          insetInline: `min(0px, max(calc((100% - ${MIN_TARGET}) / 2), -${inlineReach}))`,
        },
      },
    },
  },
});
