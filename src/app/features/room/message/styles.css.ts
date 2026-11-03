import { style } from '@vanilla-extract/css';
import { DefaultReset, config, toRem } from 'folds';

/** The message row; its options bar is positioned against it. */
export const MessageBase = style({
  position: 'relative',
  outline: 'none',
});

/** Avatar with the model badge of an agent's reply pinned to its corner. */
export const MessageAvatarWithModel = style({ display: 'inline-flex', position: 'relative' });

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
