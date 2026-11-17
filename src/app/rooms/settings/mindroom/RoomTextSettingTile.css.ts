import { keyframes, style } from '@vanilla-extract/css';
import { config } from 'folds';

// Save for a moment after a write: full color though it cannot be pressed, as Invite sent does.
export const Saved = style({
  vars: { [config.opacity.Disabled]: '1' },
  selectors: { '&[disabled]': { cursor: 'default' } },
});

const CheckPop = keyframes({
  from: { opacity: 0, transform: 'scale(0.5)' },
  to: { opacity: 1, transform: 'scale(1)' },
});

export const SavedCheck = style({
  animation: `${CheckPop} 200ms ease-out`,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
    },
  },
});

/** Read by screen readers only: the line that says the setting was saved. */
export const VisuallyHidden = style({
  position: 'absolute',
  inlineSize: 1,
  blockSize: 1,
  margin: 0,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
});
