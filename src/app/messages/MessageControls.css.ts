import { style } from '@vanilla-extract/css';
import { DefaultReset, toRem } from 'folds';

export const AiRunInfoButton = style([
  DefaultReset,
  {
    display: 'inline-flex',
    alignItems: 'center',
    inlineSize: toRem(18),
    blockSize: toRem(18),
    justifyContent: 'center',
    border: 0,
    borderRadius: toRem(999),
    padding: 0,
    backgroundColor: 'transparent',
    // The text colour at the time's muted strength, so the icon reads as part of the time.
    color: 'inherit',
    opacity: 0.75,
    cursor: 'pointer',
    selectors: {
      '&:hover, &[aria-expanded="true"]': {
        opacity: 1,
      },
      '&:focus-visible': {
        opacity: 1,
        outline: `${toRem(2)} solid currentColor`,
        outlineOffset: toRem(1),
      },
    },
  },
]);

// The header stays inside the scroll viewport, as in the approval review.
export const ReplyDetailsScroll = style({
  maxHeight: 'min(80dvh, calc(100dvh - 24px))',
});
