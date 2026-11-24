import { style } from '@vanilla-extract/css';
import { config } from 'folds';
import { motion } from '../../ui/styles/Motion.css';
import { touchTarget } from '../../ui/styles/touchTarget';

const revealTransition = `opacity ${motion.duration.Normal} ${motion.easing.Standard}`;

/** Section header row: suppresses text selection and iOS callout during a touch long press. */
export const Header = style({
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
});

/** Trailing action buttons (`+` and `⋮`) beside a section's collapse heading button. */
export const SectionActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  flexShrink: 0,
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
      [`${Header}:hover &`]: { opacity: 1 },
      [`${Header}:focus-within &`]: { opacity: 1 },
      [`${Header}[data-menu-open="true"] &`]: { opacity: 1 },
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
 * On an empty editable section, keeps `+` subtly visible at rest so the section reads as an
 * actionable target without adding an extra inline row.
 */
export const EmptyAddButton = style({
  opacity: 0.5,
  selectors: {
    [`${Header}:hover &`]: { opacity: 1 },
    [`${Header}:focus-within &`]: { opacity: 1 },
    [`${Header}[data-menu-open="true"] &`]: { opacity: 1 },
  },
});
