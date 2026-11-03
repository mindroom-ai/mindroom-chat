import { style } from '@vanilla-extract/css';
import { DefaultReset, config, toRem } from 'folds';

/** The message row; its options bar is positioned against it. */
export const MessageBase = style({
  position: 'relative',
  outline: 'none',
});

/** Avatar with the model badge of an agent's reply pinned to its corner. */
export const MessageAvatarWithModel = style({
  position: 'relative',























  fontSize: toRem(18),



















  maxWidth: toRem(240),
  wordBreak: 'break-word',
});
