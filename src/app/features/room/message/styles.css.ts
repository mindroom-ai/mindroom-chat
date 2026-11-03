import { style } from '@vanilla-extract/css';
import { DefaultReset, config, toRem } from 'folds';

/** The message row; its options bar is positioned against it. */
export const MessageBase = style({
  position: 'relative',
  outline: 'none',
});

/**
 * An agent's avatar with its model badge stacked underneath. The column keeps the avatar's width,
 * so a badge wider than the avatar hangs out evenly on both sides instead of pushing it aside.
 */
export const MessageAvatarWithModel = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  rowGap: toRem(3),
  width: '100%',
});

/** The reaction chips under a message. */
export const ReactionsContainer = style({ paddingBlockStart: config.space.S100 });

/** Long reactor lists wrap inside the chip's tooltip instead of stretching it. */
export const ReactionsTooltipText = style({ maxWidth: toRem(240), wordBreak: 'break-word' });

/** Hover options float over the top edge of the row, at the end side. */
export const MessageOptionsBase = style([
  DefaultReset,
  {
    zIndex: 1,
    position: 'absolute',
    insetBlockStart: toRem(-30),
    insetInlineEnd: 0,
  },
]);

/** The bar inside the options container: a tight row of icon buttons. */
export const MessageOptionsBar = style([DefaultReset, { padding: config.space.S100 }]);

/** Menu entry labels take the row's free width, so trailing icons line up. */
export const MessageMenuItemText = style({ flexGrow: 1 });

/** A quick-reaction emoji in the message menu; emoji read better a little larger than text. */
export const MessageQuickReaction = style({
  lineHeight: 1,
  minInlineSize: toRem(32),
  fontSize: toRem(18),
});

/** A column of entries inside the message menu. */
export const MessageMenuGroup = style({ padding: config.space.S100 });
