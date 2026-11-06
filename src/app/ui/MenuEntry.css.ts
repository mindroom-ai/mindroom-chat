import { style } from '@vanilla-extract/css';
import { config } from 'folds';

/**
 * A menu entry that cannot be used here and says why. folds dims a whole disabled item; this one
 * stays at full strength so its reason reads clearly, and dims its label and icon itself.
 */
export const Unavailable = style({
  selectors: {
    '&&[aria-disabled="true"]': { opacity: '1 !important' },
  },
});

/** The label over its reason, which wraps rather than being cut off. */
export const UnavailableText = style({
  minWidth: 0,
  textAlign: 'start',
  whiteSpace: 'normal',
  paddingBlock: config.space.S100,
});
