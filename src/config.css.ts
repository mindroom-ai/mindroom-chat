import { style } from '@vanilla-extract/css';
import { config } from 'folds';

// Small corners (buttons, menu rows) are 8px, as in the original, rather than folds' 4px. The
// medium and large radii keep folds' 0.5rem and 0.75rem: the original's Compact cards measure 8px
// and its thread banner and filter bar 12px. The class sits beside folds' config class on the same
// element, so the doubled selector outranks that class's defaults whichever stylesheet loads first.
export const roundedRadii = style({
  selectors: {
    '&&': {
      vars: { [config.radii.R300]: '0.5rem' },
    },
  },
});
