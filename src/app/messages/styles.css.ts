import { createVar, fallbackVar, globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { ScrollableMenuRows } from '../ui/ScrollableMenu.css';
import { glassDenseOverBackdrop } from '../ui/styles/Glass.css';
import { touchTarget } from '../ui/styles/touchTarget';

/** The message row; its options bar is positioned against it. */
export const MessageBase = style({
  position: 'relative',
  outline: 'none',
});

/**
 * Tight wrapper around the sender name and timestamp at the start of the header row so hover
 * toolbar placement measures only the occupied header width. The sender button reserves its touch
 * area in the row so no invisible layer covers links in the first body line.
 */
export const SenderLine = style({
  width: 'fit-content',
  maxWidth: '100%',
});
globalStyle(`${SenderLine} button`, {
  '@media': {
    '(pointer: coarse)': {
      minBlockSize: 44,
      minInlineSize: 44,
      alignItems: 'center',
    },
  },
});

/** Subtle compact timestamp in the empty avatar column of a hovered follow-up row. */
export const CollapsedTime = style({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  minBlockSize: config.lineHeight.T400,
  userSelect: 'none',
});
globalStyle(`${CollapsedTime} time`, {
  fontSize: toRem(10),
  lineHeight: 1,
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '-0.02em',
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
export const ReactionsContainer = style({
  paddingBlockStart: config.space.S100,
  // 28 px reaction pills reach 8 px up and down on coarse pointers: 16 px (`S400`) between wrapped
  // rows keeps layers disjoint, and 8 px (`S200`) above clears the message line. `&&` overrides
  // Folds `<Box gap="200">` regardless of CSS chunk order.
  '@media': {
    '(pointer: coarse)': {
      selectors: {
        '&&': {
          rowGap: config.space.S400,
          paddingBlockStart: config.space.S200,
        },
      },
    },
  },
});

// The reply's Stop holds Stop reply and Stopping… in one cell, so it keeps the wider one's size.
export const StopLabels = style({ display: 'inline-grid' });
export const StopLabel = style({ gridArea: '1 / 1' });
export const StopLabelHidden = style([StopLabel, { visibility: 'hidden' }]);

// Says Stopping… for screen readers, beside the Stop, whose name stays.
export const StopStatus = style({
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
});

/** Long reactor lists wrap inside the chip's tooltip instead of stretching it. */
export const ReactionsTooltipText = style({ maxWidth: toRem(240), wordBreak: 'break-word' });

// Banner action buttons (ThreadBannerChrome, ThreadContextBanner, CrossRoomForkDraftBanner) keep
// their 32 px square geometry via MessageOptionsButton below.
const toolbarButtonSize = toRem(32);
const toolbarButtonRadius = config.radii.R400;

// The message hover toolbar's compact buttons are 26 px square inside 2 px of padding, 2 px apart.
const compactToolbarButtonSize = toRem(26);
const compactToolbarButtonRadius = config.radii.R300;
const compactToolbarPadding = toRem(2);

/**
 * Hover options dock inside the top-end corner of a headered row (32 px tall: a 26 px button,
 * 2 px of padding and a 1 px rim on each side), aligned with the message content's inline-end edge.
 */
export const MessageOptionsBase = style([
  DefaultReset,
  {
    zIndex: 1,
    position: 'absolute',
    insetBlockStart: toRem(2),
    insetInlineEnd: config.space.S400,
  },
]);

/** Modern follow-up rows have no header row, so the pill straddles the top edge. */
export const MessageOptionsBaseCollapsed = style({
  insetBlockStart: toRem(-14),
  '@media': {
    '(pointer: coarse)': {
      insetBlockStart: toRem(-17),
    },
  },
});

/**
 * Bubble and Compact rows keep the pill floating cleanly above the row (6 px into the top padding,
 * matching main's -36 px for the old 42 px pill) so own bubbles, own avatars, and narrow Compact
 * sender timestamps stay unobstructed.
 */
export const MessageOptionsBaseAbove = style({
  insetBlockStart: toRem(-26),
  '@media': {
    '(pointer: coarse)': {
      insetBlockStart: toRem(-32),
    },
  },
});

/**
 * The compact bordered glass pill around the hover toolbar's buttons. Its corners are concentric
 * with theirs: the pill's radius is the button's plus the padding and the rim between their edges.
 * It takes the nearly opaque tint and keeps its rim and blur so icons stay legible over text/code.
 */
export const MessageOptionsBar = style([
  DefaultReset,
  glassDenseOverBackdrop,
  {
    padding: compactToolbarPadding,
    borderRadius: `calc(${compactToolbarButtonRadius} + ${compactToolbarPadding} + ${config.borderWidth.B300})`,
  },
]);

/** The row of buttons and optional separator inside the pill. */
export const MessageOptionsRow = style({ gap: toRem(2), alignItems: 'center' });

/**
 * A compact 26 px square button inside the message hover toolbar: transparent at rest so the pill
 * is the only surface, taking the quiet hover tint on hovering pointers and keyboard focus.
 */
export const MessageToolbarButton = style({
  selectors: {
    '&&': {
      inlineSize: compactToolbarButtonSize,
      blockSize: compactToolbarButtonSize,
      padding: 0,
      flexShrink: 0,
      borderRadius: compactToolbarButtonRadius,
    },
  },
  '@media': {
    '(pointer: coarse)': {
      selectors: {
        '&&': {
          inlineSize: toolbarButtonSize,
          blockSize: toolbarButtonSize,
        },
      },
    },
    '(hover: none)': {
      selectors: {
        '&&:hover:not(:focus-visible):not(:active):not([aria-pressed="true"])': {
          backgroundColor: 'transparent',
        },
      },
    },
  },
});

/** Primary accent for the agent run stats button in the message hover toolbar. */
export const MessageToolbarRunStatsButton = style({
  selectors: {
    '&&': {
      color: color.Primary.Main,
    },
  },
});

/** Success tint for the copied check icon in the message hover toolbar. */
export const MessageToolbarCopiedIcon = style({
  color: color.Success.Main,
});

/** Hairline vertical divider separating the agent run stats button from message actions. */
export const MessageToolbarSeparator = style({
  inlineSize: config.borderWidth.B300,
  blockSize: toRem(14),
  marginInline: toRem(1),
  backgroundColor: color.SurfaceVariant.ContainerLine,
  flexShrink: 0,
});

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

/**
 * The message menu's scrollable rows. The menu often opens under the finger of a long press, where
 * iOS would select the first entry's text and show its Copy bar; their text is never selectable.
 */
export const MessageMenuRows = style([
  ScrollableMenuRows,
  {
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTouchCallout: 'none',
  },
]);
