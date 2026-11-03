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









    insetInlineEnd: 0,
    zIndex: 1,
  },
]);

/** The bar inside the options container: a tight row of icon buttons. */
export const MessageOptionsBar = style([DefaultReset, { padding: config.space.S100 }]);

/** A quick-reaction emoji in the message menu; emoji read better a little larger than text. */
export const MessageQuickReaction = style({
  lineHeight: 1,
  minInlineSize: toRem(32),















  paddingBlockStart: config.space.S100,
});

/** Long reactor lists wrap inside the chip's tooltip instead of stretching it. */
export const ReactionsTooltipText = style({
  maxWidth: toRem(240),
  wordBreak: 'break-word',
});
