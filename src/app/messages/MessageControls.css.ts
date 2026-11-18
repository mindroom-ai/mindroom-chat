import { globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, color, toRem } from 'folds';

/**
 * The info button and the time beside it. With a hovering pointer the time also opens the reply
 * details, so it gets the pointer cursor and hovering either lights up the button.
 */
export const AiRunDetailsTarget = style({});
globalStyle(`${AiRunDetailsTarget} time`, {
  '@media': { '(hover: hover)': { cursor: 'pointer' } },
});

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
      '&[aria-expanded="true"]': {
        opacity: 1,
      },
      '&:focus-visible': {
        opacity: 1,
        outline: `${toRem(2)} solid currentColor`,
        outlineOffset: toRem(1),
      },
    },
    '@media': {
      '(hover: hover)': {
        selectors: {
          [`${AiRunDetailsTarget}:hover &`]: { opacity: 1, color: color.Primary.Main },
        },
      },
    },
  },
]);

// The header stays inside the scroll viewport, as in the approval review.
export const ReplyDetailsScroll = style({
  maxHeight: 'min(80dvh, calc(100dvh - 24px))',
});
