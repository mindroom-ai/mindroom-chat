import { style } from '@vanilla-extract/css';

/**
 * A menu entry that cannot be used here and says why. folds dims a whole disabled item; this one
 * stays at full strength so its reason reads clearly, and dims its label and icon itself. folds
 * also gives every row one fixed height; this one grows with its reason's lines, which would
 * otherwise spill over the rows above and below it.
 */
export const Unavailable = style({
  selectors: {
    '&&[aria-disabled="true"]': { opacity: '1 !important', height: 'auto' },
  },
});
