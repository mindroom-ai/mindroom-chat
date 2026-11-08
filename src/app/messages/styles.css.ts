import { createVar, fallbackVar, globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, config, toRem } from 'folds';
import { glassDenseOverBackdrop } from '../ui/styles/Glass.css';
import { touchTarget } from '../ui/styles/touchTarget';

/** The message row; its options bar is positioned against it. */
export const MessageBase = style({
  position: 'relative',
  outline: 'none',
});

/**
 * The sender and reply-details buttons reserve their touch area in the row. An invisible layer
 * outside this line would cover links in the first body line or the following activity button.
 */
export const SenderLine = style({});
globalStyle(`${SenderLine} button`, {
  '@media': {
    '(pointer: coarse)': {
      minBlockSize: 44,
      minInlineSize: 44,
      alignItems: 'center',
    },
  },
});

/**
 * An agent's avatar with its model's name stacked underneath. The column keeps the avatar's width,
 * so a name wider than the avatar hangs out evenly on both sides instead of pushing it aside; the
 * gap keeps the name clear of the provider mark on the avatar's corner.
 */
export const MessageAvatarWithModel = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  rowGap: toRem(6),
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

/** The fill of a toolbar button at rest, for a button that has one (the resolved check). */
export const toolbarButtonRestFill = createVar();

// In the thread banner, 4 px apart, a finger gets a hit area 44 px tall and 36 px wide; the hover
// toolbar's buttons, 2 px apart in a pill over the rows, keep theirs as drawn.
const bannerTouchTarget = style(touchTarget('2px', '[data-thread-context-banner] '));

/**
 * A toolbar button: no tile of its own at rest, so the pill is the only surface. It takes the
 * quiet tint on hover and keyboard focus, and the stronger one while pressed or its menu is open.
 * A touch screen keeps :hover on the button tapped last, where the tint would stay and read as
 * pressed, so where the pointer cannot hover the button keeps its rest fill under :hover.
 */
export const MessageOptionsButton = style([
  bannerTouchTarget,
  {
    selectors: {
      '&&': {
        inlineSize: toolbarButtonSize,
        blockSize: toolbarButtonSize,
        padding: 0,
        flexShrink: 0,
        borderRadius: toolbarButtonRadius,
      },
    },
    '@media': {
      '(hover: none)': {
        selectors: {
          '&&:hover:not(:focus-visible):not(:active):not([aria-pressed="true"])': {
            backgroundColor: fallbackVar(toolbarButtonRestFill, 'transparent'),
          },
        },
      },
    },
  },
]);

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
/**
 * The message menu's entries. The menu often opens under the finger of a long press, where iOS
 * would select the first entry's text and show its Copy bar; their text is never selectable.
 */
export const MessageMenuGroup = style({
  padding: config.space.S100,
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
});
