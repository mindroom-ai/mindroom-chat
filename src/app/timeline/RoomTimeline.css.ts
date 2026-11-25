import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';
import { footerInset } from '../ui/styles/RoomOverlay.css';
import { compactJumpArea } from '../ui/styles/roomArea.css';
import { touchTarget } from '../ui/styles/touchTarget';

/** A control that hovers over the timeline, centered at its top or bottom edge. */
export const TimelineFloat = recipe({
  base: {
    position: 'absolute',
    insetInline: 0,
    marginInline: 'auto',
    width: 'max-content',
    maxWidth: `calc(100% - ${config.space.S400} * 2)`,
    zIndex: 2,
    display: 'flex',
    gap: config.space.S200,
    pointerEvents: 'auto',
  },
  variants: {
    position: {
      Top: { top: config.space.S300 },
      Bottom: { bottom: config.space.S400 },
    },
    /**
     * Pills that do not fit side by side (the unread pills in most languages on a phone) stack:
     * the second moves under the first instead of squeezing both.
     */
    wrap: {
      true: { flexWrap: 'wrap', justifyContent: 'center' },
    },
  },
  defaultVariants: { position: 'Top' },
});

/**
 * A floating pill (Jump to Latest, Jump to Unread, Mark as Read): 44 px tall to a finger. A label
 * longer than the whole float (Bengali's Mark as Read on a phone) breaks into a second line, and
 * the pill grows with it instead of letting the words spill out.
 */
export const FloatingAction = style([
  touchTarget('4px'),
  {
    minWidth: 0,
    maxWidth: '100%',
    selectors: {
      '&&': { height: 'auto', minHeight: toRem(24), paddingBlock: toRem(2) },
    },
  },
]);

/**
 * Keeps Jump to Latest low above the composer so typing and read receipts can share the dock row
 * beside it without shifting it; uses +S200 in compact areas to sit vertically flush with the
 * 32 px dock row.
 */
export const JumpToLatestFloat = style({
  bottom: `calc(var(--room-composer-height, ${footerInset}) + ${config.space.S400})`,
  maxWidth: `min(calc(100% - ${config.space.S400} * 2), 11rem)`,
  '@container': {
    [compactJumpArea]: {
      bottom: `calc(var(--room-composer-height, ${footerInset}) + ${config.space.S200})`,
      maxWidth: 'none',
      '@media': {
        '(pointer: coarse)': {
          bottom: `calc(var(--room-composer-height, ${footerInset}) + max(${config.space.S200}, calc(22px - 1rem)))`,
        },
      },
    },
  },
});

/**
 * Collapses Jump to Latest to a 32 × 32 px circular arrow button in compact (narrow or short)
 * panes while giving coarse pointers a 44 × 44 px hit area inside the 44 px center lane.
 * Triple-class specificity (`&&&`) beats folds' Chip `[data-ui-before=true]` inline padding and
 * `FloatingAction`'s `&&` height/padding rules regardless of stylesheet order.
 */
export const JumpToLatestButton = style([
  // Placed after FloatingAction so its 16px inline reach overrides FloatingAction's 4px and
  // guarantees a full 44 × 44 px hit area on the outlined 32 × 32 px button across Page Zoom
  // levels down to 50% (14 px padding box, -15 px) without exceeding 44 px.
  touchTarget('16px'),
  {
    '@container': {
      [compactJumpArea]: {
        selectors: {
          '&&&': {
            inlineSize: toRem(32),
            blockSize: toRem(32),
            minHeight: toRem(32),
            padding: 0,
            gap: 0,
            justifyContent: 'center',
          },
        },
      },
    },
  },
]);

/** Visually hidden in compact panes while keeping the button's accessible name intact. */
export const JumpToLatestLabel = style({
  textWrap: 'balance',
  '@container': {
    [compactJumpArea]: {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: 0,
      margin: '-1px',
      overflow: 'hidden',
      clipPath: 'inset(50%)',
      whiteSpace: 'nowrap',
      border: 0,
    },
  },
});

/** "[+all]": 16 px of text in a 1 px rim, 18 px tall, as thread-light.png shows it. */
const expandAllPillHeight = `calc(${toRem(16)} + 2px)`;

/**
 * The button is the hit area and a layer behind its text paints the pill, so a touch screen
 * reserves a 44 px target in layout, below the pill, instead of raising a layer into the row below
 * or the floating controls. The button's inline `all: unset` requires important sizes.
 */
export const ExpandAllToggle = style({
  selectors: {
    '&::before': {
      content: '""',
      position: 'absolute',
      zIndex: -1,
      insetBlockStart: -1,
      insetInline: -1,
      blockSize: expandAllPillHeight,
      boxSizing: 'border-box',
      borderRadius: config.radii.Pill,
      border: `1px solid ${color.SurfaceVariant.ContainerLine}`,
      backgroundColor: `color-mix(in srgb, ${color.Surface.Container} 72%, transparent)`,
      pointerEvents: 'none',
    },
  },
  '@media': {
    '(pointer: coarse)': {
      paddingBlockEnd: `calc(44px - ${expandAllPillHeight}) !important`,
      minInlineSize: '44px !important',
    },
  },
});

/** Softens read-only parent messages shown above the fork divider in an unsent fork draft. */
export const ForkDraftPrefixRow = style({
  opacity: 0.78,
  marginInlineStart: config.space.S300,
  paddingInlineStart: config.space.S100,
  borderInlineStart: `2px dashed ${color.SurfaceVariant.ContainerLine}`,
  minWidth: 0,
  boxSizing: 'border-box',
});
