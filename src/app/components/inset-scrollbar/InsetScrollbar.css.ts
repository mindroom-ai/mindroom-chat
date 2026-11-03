import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/** A scroll container that keeps native scrolling but hides the platform scrollbar. */
export const Viewport = style({
  overflowX: 'hidden',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  scrollbarWidth: 'none',
  selectors: {
    '&::-webkit-scrollbar': { display: 'none' },
  },
});

/** Vertical track; the caller's class places it (top, bottom, z-index) beside the viewport. */
export const Track = style({
  position: 'absolute',
  right: toRem(2),
  width: toRem(12),
  display: 'flex',




  touchAction: 'none',
  transition: 'opacity 200ms ease',
  outline: 'none',
  selectors: {
    '&[data-overflow="false"]': { display: 'none' },
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
  backgroundColor: color.SurfaceVariant.OnContainer,
  opacity: config.opacity.P300,
  willChange: 'transform',
  transition: 'width 120ms ease',
  selectors: {
    [`${Track}:hover &, ${Track}[data-active="true"] &`]: { width: toRem(6) },
  },
});
