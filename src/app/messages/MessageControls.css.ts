import { globalStyle, style } from '@vanilla-extract/css';
import { color } from 'folds';

/**
 * The timestamp wrapper of an agent reply. With a hovering pointer, clicking the time opens the
 * reply details, so it gets the pointer cursor and highlights in the primary colour on hover.
 */
export const AiRunDetailsTarget = style({});
globalStyle(`${AiRunDetailsTarget} time`, {
  '@media': { '(hover: hover)': { cursor: 'pointer' } },
});
globalStyle(`${AiRunDetailsTarget} time:hover`, {
  '@media': { '(hover: hover)': { color: color.Primary.Main, opacity: 1 } },
});

// The header stays inside the scroll viewport, as in the approval review.
export const ReplyDetailsScroll = style({
  maxHeight: 'min(80dvh, calc(100dvh - 24px))',
});
