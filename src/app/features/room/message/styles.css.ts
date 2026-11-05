import { style } from '@vanilla-extract/css';
import { DefaultReset, config, toRem } from 'folds';
import { glassDenseOverBackdrop } from '../../../styles/Glass.css';

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

// The hover toolbar's buttons are one square size inside an even 4 px of padding, 2 px apart.
const toolbarButtonSize = toRem(32);
const toolbarButtonRadius = config.radii.R400;
const toolbarPadding = config.space.S100;

/**
 * Hover options float over the top edge of the row, at the end side. The pill is 42 px tall
 * (a 32 px button, 4 px of padding and a 1 px rim on each side), so it covers the top 6 px of the
 * row and sits 36 px above it.
 */
export const MessageOptionsBase = style([
  DefaultReset,
  {
    zIndex: 1,
    position: 'absolute',
    insetBlockStart: toRem(-36),
    insetInlineEnd: 0,
  },
]);

/**
 * The glass pill around the buttons. Its corners are concentric with theirs: the pill's radius is
 * the button's plus the padding and the rim between their edges. It sits on the row's own text
 * (the time, the line above), and with no tile behind each icon that text would show through the
 * usual glass, so the pill takes the nearly opaque tint and keeps its rim and blur.
 */
export const MessageOptionsBar = style([
  DefaultReset,
  glassDenseOverBackdrop,
  {
    padding: toolbarPadding,
    borderRadius: `calc(${toolbarButtonRadius} + ${toolbarPadding} + ${config.borderWidth.B300})`,
  },
]);

/** The row of buttons inside the pill. */
export const MessageOptionsRow = style({ gap: toRem(2) });

/**
 * A toolbar button: no tile of its own at rest, so the pill is the only surface. It takes the
 * quiet tint on hover and keyboard focus, and the stronger one while pressed or its menu is open.
 */
export const MessageOptionsButton = style({
  selectors: {
    '&&': {
      inlineSize: toolbarButtonSize,
      blockSize: toolbarButtonSize,
      padding: 0,
      flexShrink: 0,
      borderRadius: toolbarButtonRadius,
    },
  },
});

/**
 * The reply arrow is drawn from 8 to 18 in its 24 unit box, one unit below the middle. Lifting it
 * by that unit (1/24 of the icon's height) centres it in its button. A vertical nudge holds when
 * right-to-left languages mirror the arrow.
 */
export const MessageOptionsReplyIcon = style({ translate: '0 calc(-100% / 24)' });

/** A quick-reaction emoji in the message menu; emoji read better a little larger than text. */
export const MessageQuickReaction = style({
  lineHeight: 1,
  minInlineSize: toRem(32),
  fontSize: toRem(18),
});

/** A column of entries inside the message menu. */
export const MessageMenuGroup = style({ padding: config.space.S100 });
