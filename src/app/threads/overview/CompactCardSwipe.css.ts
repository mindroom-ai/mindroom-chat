import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';
import { motion } from '../../ui/styles/Motion.css';
import { transition } from '../../ui/styles/transition';

const TRAY_WIDTH = 'var(--swipe-tray-width, 156px)';

export const SwipeTrack = style({
  position: 'relative',
  minWidth: 0,
});

// For the element that holds the cards (`useCompactCardSwipeList`): the browser
// keeps vertical scrolling and pinch zoom; horizontal movement reaches the
// swipe handlers instead of panning anything. Set once there, not on each
// card: WebKit on iOS keeps a touch region for every element with a
// touch-action or a touch listener of its own, and builds them all again
// whenever the list repaints, which a swiped card does every frame. With both
// on each of 500 cards, a swipe ran at 20 frames a second in the iOS
// simulator; with one of each on this element, at 60.
export const SwipeList = style({
  touchAction: 'pan-y pinch-zoom',
});

export const SwipeTrackSettling = style({
  transition: transition(['transform'], motion.duration.Normal, motion.easing.Decelerate),
});

// Sits under the card and shows through as the card slides away, like the
// swipe actions of an iOS list row (used for resolved cards and the tour).
export const SwipeAction = style({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: config.space.S200,
  paddingInline: config.space.S400,
  overflow: 'hidden',
  borderRadius: config.radii.R400,
  backgroundColor: color.SurfaceVariant.Container,
  fontWeight: 500,
  color: color.SurfaceVariant.OnContainer,
  pointerEvents: 'none',
  transition: transition(['background-color', 'color']),
  selectors: {
    '&[data-armed="true"]': {
      backgroundColor: color.Success.Main,
      color: color.Success.OnMain,
    },
    '&[data-armed="true"][data-resolved="true"]': {
      backgroundColor: color.Primary.Main,
      color: color.Primary.OnMain,
    },
  },
});

// Split tray behind an open card: warning fills behind the card's trailing rounded
// corners (no gap beside Snooze) and flips to success when a deep pull arms Resolve.
export const SwipeTray = style({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'flex-end',
  overflow: 'hidden',
  borderRadius: config.radii.R400,
  backgroundColor: color.Warning.Main,
  pointerEvents: 'none',
  transition: transition(['background-color']),
  selectors: {
    '&[data-parked="true"]': { pointerEvents: 'auto' },
    '&[data-armed="true"]': { backgroundColor: color.Success.Main },
  },
});

export const TrayButton = style([
  DefaultReset,
  {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: config.space.S100,
    flex: `0 0 calc(${TRAY_WIDTH} / 2)`,
    minInlineSize: 0,
    padding: config.space.S100,
    overflow: 'hidden',
    cursor: 'pointer',
    fontWeight: 500,
    transition: transition(['flex-basis', 'opacity', 'padding-inline', 'background-color']),
    ':focus-visible': {
      outline: `${config.borderWidth.B300} solid currentColor`,
      outlineOffset: '-3px',
    },
  },
]);

export const SnoozeButton = style({
  backgroundColor: color.Warning.Main,
  color: color.Warning.OnMain,
  ':hover': { backgroundColor: color.Warning.MainHover },
  ':active': { backgroundColor: color.Warning.MainActive },
  selectors: {
    [`${SwipeTray}[data-armed="true"] &`]: {
      flexBasis: 0,
      paddingInline: 0,
      opacity: 0,
      pointerEvents: 'none',
    },
  },
});

export const ResolveButton = style({
  backgroundColor: color.Success.Main,
  color: color.Success.OnMain,
  ':hover': { backgroundColor: color.Success.MainHover },
  ':active': { backgroundColor: color.Success.MainActive },
  selectors: {
    [`${SwipeTray}[data-armed="true"] &`]: { flexBasis: TRAY_WIDTH },
  },
});

export const TrayLabel = style({
  maxInlineSize: '100%',
  fontWeight: 500,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
