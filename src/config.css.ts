import { style } from '@vanilla-extract/css';
import { config } from 'folds';

// Rounder small and medium corners than folds' defaults: 6px for buttons and menu rows, 10px for
// menus and list rows. The large radius (panels, cards, the thread banner) keeps folds' 0.75rem.
// The class sits beside folds' config class on the same element, so the doubled selector
// outranks that class's defaults whichever stylesheet loads first.
export const roundedRadii = style({
  selectors: {
    '&&': {
      vars: {
        [config.radii.R300]: '0.375rem',
        [config.radii.R400]: '0.625rem',
      },
    },
  },
});
