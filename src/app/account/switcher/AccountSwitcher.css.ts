import { style } from '@vanilla-extract/css';
import { config, toRem } from 'folds';

// A list of a few accounts needs about 480 px, not the 800 px of the settings dialog it shares the
// frame with. A phone's dialog still fills its screen (Modal500's PhoneModal wins over this).
export const AccountsDialog = style({
  selectors: {
    '&&': {
      maxWidth: `min(${toRem(480)}, calc(100% - 2 * ${config.space.S400}))`,
    },
  },
});
