import { style } from '@vanilla-extract/css';
import { color } from 'folds';

// Green while a call runs; its outline lights up while someone in the call talks.
export const CallTab = style({
  background: color.Success.Container,
  color: color.Success.OnContainer,
  selectors: {
    '&[data-speaking="true"]': { outlineColor: color.Success.Main },
  },
});
