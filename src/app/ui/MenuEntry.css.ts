import { style } from '@vanilla-extract/css';
import { config } from 'folds';

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

/** An entry with a line under its label: the row grows to hold it, as an unavailable one does. */
export const Described = style({
  selectors: {
    '&&': { height: 'auto' },
  },
});

/**
 * A decorative folds Switch inside a `menuitemcheckbox` row. Passing `disabled` removes the inner
 * `<button>` from focus and assistive tech (avoiding axe-core's `nested-interactive` violation);
 * this restores folds' enabled Switch opacity (`P300` = 0.75 unchecked, `P500` = 1 checked) and
 * pointer/cursor behavior over folds' `[disabled]` rule.
 */
export const DecorativeSwitch = style({
  pointerEvents: 'none',
  selectors: {
    '&&[disabled]': {
      cursor: 'inherit',
    },
    '&&[disabled][aria-checked="false"]': {
      opacity: `${config.opacity.P300} !important`,
    },
    '&&[disabled][aria-checked="true"]': {
      opacity: `${config.opacity.P500} !important`,
    },
  },
});
