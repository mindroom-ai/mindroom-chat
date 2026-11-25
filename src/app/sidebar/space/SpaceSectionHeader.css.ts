import { createVar, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { motion } from '../../ui/styles/Motion.css';
import { touchTarget } from '../../ui/styles/touchTarget';

const revealTransition = `opacity ${motion.duration.Normal} ${motion.easing.Standard}`;
const actionsEndPad = createVar();

/** Section header row: compact 28px desktop pitch, touch fallback, and long-press suppression. */
export const Header = style({
  position: 'relative',
  minHeight: toRem(28),
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  '@media': {
    '(hover: none)': {
      minHeight: toRem(32),
    },
  },
});

const activeHeader = (extra = '') =>
  `${Header}${extra}:is(:hover, :focus-within, [data-menu-open="true"])`;

/** Collapsed unread indicator wrapper: right-aligned at rest, fades out when actions reveal. */
export const UnreadSlot = style({
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  transition: revealTransition,
  selectors: {
    [`${activeHeader()} &`]: { opacity: 0 },
  },
  '@media': {
    '(hover: none)': {
      selectors: {
        [`${activeHeader()} &`]: { opacity: 1 },
      },
    },
  },
});

/** Quiet unread dot for Home space sections (works on all light/dark palettes). */
export const QuietUnreadDot = style({
  display: 'block',
  width: toRem(5),
  height: toRem(5),
  borderRadius: config.radii.Pill,
  backgroundColor: 'color-mix(in srgb, currentColor 45%, transparent)',
});

/** Clean accent dot for Home space sections with mentions or highlights (no outer ring). */
export const QuietHighlightDot = style({
  display: 'block',
  width: toRem(6),
  height: toRem(6),
  borderRadius: config.radii.Pill,
  backgroundColor: color.Primary.Main,
});

/**
 * Collapsible heading button: uses full row width at rest, reserves inline-end space when hover
 * overlay actions appear (or empty `+` is shown), and caps coarse-pointer vertical hit expansion
 * so stacked 28px collapsed rows do not overlap.
 */
export const HeaderButton = style({
  vars: { [actionsEndPad]: toRem(4) },
  paddingInlineEnd: actionsEndPad,
  selectors: {
    [`${activeHeader('[data-actions-count="1"]')} &, ${Header}[data-empty-add="true"][data-actions-count="1"] &`]:
      { vars: { [actionsEndPad]: toRem(32) } },
    [`${activeHeader('[data-actions-count="2"]')} &, ${Header}[data-empty-add="true"][data-actions-count="2"] &`]:
      { vars: { [actionsEndPad]: toRem(64) } },
    [`${activeHeader('[data-actions-count="1"]')} &:has(${UnreadSlot})`]: {
      vars: { [actionsEndPad]: toRem(8) },
    },
    [`${activeHeader('[data-actions-count="2"]')} &:has(${UnreadSlot})`]: {
      vars: { [actionsEndPad]: toRem(40) },
    },
  },
  '@media': {
    '(hover: none)': {
      paddingInlineEnd: toRem(4),
    },
    '(pointer: coarse)': {
      selectors: {
        [`${Header} &&[aria-expanded="false"]::after`]: {
          insetBlock: 'min(0px, max(calc((100% - 44px) / 2), -1px))',
        },
      },
    },
  },
});

/**
 * Trailing action buttons (`+` and `⋮`): overlaid at the inline end on desktop so collapsed rows
 * keep full label width and right-aligned unread dots at rest; stays in flex flow on touch.
 */
export const SectionActions = style({
  position: 'absolute',
  insetInlineEnd: config.space.S100,
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  flexShrink: 0,
  pointerEvents: 'none',
  selectors: {
    [`${activeHeader()} &`]: { pointerEvents: 'auto' },
  },
  '@media': {
    '(hover: none)': {
      position: 'static',
      insetInlineEnd: 'auto',
      top: 'auto',
      transform: 'none',
      pointerEvents: 'auto',
    },
  },
});

/**
 * Compact section action button: hidden at rest on hover-capable pointers and revealed purely via
 * CSS on header hover, focus-within, or while its menu is open. Keeps non-overlapping touch target
 * margins when `+` and `⋮` sit side by side.
 */
export const ActionButton = style([
  touchTarget('2px', '', { blockReach: '2px' }),
  {
    opacity: 0,
    transition: revealTransition,
    selectors: {
      [`${activeHeader()} &`]: { opacity: 1 },
    },
    '@media': {
      '(hover: none)': {
        opacity: 0.75,
      },
    },
  },
]);

/**
 * On touch/non-hover devices, sub-space `+` is hidden because its entries are folded into `⋮`,
 * cutting right-edge icon clutter in half.
 */
export const SubspaceAddButton = style({
  '@media': {
    '(hover: none)': {
      display: 'none',
    },
  },
});

/**
 * On an empty editable section, keeps `+` subtly visible and directly clickable at rest so the
 * section reads as an actionable target without adding an extra inline row.
 */
export const EmptyAddButton = style({
  opacity: 0.5,
  pointerEvents: 'auto',
  selectors: {
    [`${activeHeader()} &`]: { opacity: 1 },
  },
});
