import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/** A scroll container that keeps native scrolling but hides the platform scrollbar. */
export const Viewport = style({
  overflowX: 'hidden',
  overflowY: 'auto',
  // Vertical only: containing the horizontal axis too kept a trackpad's two-finger swipe from
  // reaching Chrome, which then never went back (an open thread to its room).
  overscrollBehaviorY: 'contain',
  scrollbarWidth: 'none',
  selectors: {
    '&::-webkit-scrollbar': { display: 'none' },
  },
});

/**
 * Vertical track at the viewport's end edge, where the platform puts a scrollbar (the left in a
 * right-to-left language); the caller's class places it (top, bottom, z-index) beside it.
 */
export const Track = style({
  position: 'absolute',
  insetInlineEnd: toRem(2),
  width: toRem(12),
  display: 'flex',
  // The thumb is absolutely positioned; centering puts its static position mid-track.
  justifyContent: 'center',
  // Hidden until scrolling, hovering, dragging or keyboard focus reveals it.
  opacity: 0,
  cursor: 'default',
  userSelect: 'none',
  touchAction: 'none',
  transition: 'opacity 200ms ease',
  outline: 'none',
  selectors: {
    // Hidden but still laid out: the component reads the track's height to find overflow.
    '&[data-overflow="false"]': { visibility: 'hidden' },
    '&[data-active="true"], &:hover, &:focus-visible': { opacity: 1 },
    '&:focus-visible': {
      boxShadow: `0 0 0 ${config.borderWidth.B300} ${color.Primary.Main}`,
    },
  },
});

export const Thumb = style({
  position: 'absolute',
  top: 0,
  width: toRem(4),
  borderRadius: config.radii.Pill,
  // The same theme variable as the patched folds scrollbars (a translucent color per theme).
  backgroundColor: `var(--mr-scrollbar-thumb-color, ${color.SurfaceVariant.ContainerLine})`,
  willChange: 'transform',
  transition: 'width 120ms ease',
  selectors: {
    [`${Track}:hover &, ${Track}[data-active="true"] &`]: { width: toRem(6) },
  },
});
