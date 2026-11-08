import { style } from '@vanilla-extract/css';
import { DefaultReset, color } from 'folds';
import { phoneTopBarHeight } from './PhoneTopBar.css';
import { motion } from '../ui/styles/Motion.css';
import { cardRadius } from '../ui/page/floatingCards.css';

// How long the drawer takes to slide in or out, and the scrim to fade with it; reduced motion
// collapses it app-wide (src/index.css).
const SLIDE = motion.duration.Slower;
const EASE = motion.easing.Standard;

// Both layers cover the area below the top bar; the bar stays usable above them.
const belowTopBar = {
  position: 'absolute',
  insetBlockStart: phoneTopBarHeight,
  insetBlockEnd: 0,
  insetInlineStart: 0,
} as const;

/**
 * The layer a sheet from the end edge (a room's members, `PhoneMembersSheet`) slides in: the page's
 * area below the top bar, under the drawer. Taps pass through it wherever the sheet is not.
 */
export const SheetSlot = style([
  DefaultReset,
  belowTopBar,
  { insetInlineEnd: 0, zIndex: 1, pointerEvents: 'none' },
]);

/** Dims the page while the drawer is out; a tap on it puts the drawer away. */
export const Scrim = style([
  DefaultReset,
  belowTopBar,
  {
    insetInlineEnd: 0,
    zIndex: 1,
    backgroundColor: color.Other.Overlay,
    opacity: 0,
    visibility: 'hidden',
    // While it fades out, taps already reach the page below it.
    pointerEvents: 'none',
    selectors: {
      '&[data-open]': { opacity: 1, visibility: 'visible', pointerEvents: 'auto' },
      '&[data-animate]': { transition: `opacity ${SLIDE} ${EASE}, visibility 0s ${SLIDE}` },
      '&[data-animate][data-open]': { transition: `opacity ${SLIDE} ${EASE}` },
    },
  },
]);

/**
 * The drawer: the rail and the section's list side by side, as wide as the screen leaves room for
 * beside a strip of the scrim, or as wide as the rail when the page has no list. A sheet over the
 * page, it rounds its one free corner as the page's card does where it floats: the top one meets the
 * bar and the others the screen's edge. Off screen past the start edge while closed, and hidden
 * once it got there.
 */
export const Panel = style([
  DefaultReset,
  belowTopBar,
  {
    zIndex: 1,
    display: 'flex',
    inlineSize: 'min(calc(100% - 56px), 420px)',
    backgroundColor: color.Background.Container,
    boxShadow: `0 0 24px ${color.Other.Shadow}`,
    borderEndEndRadius: cardRadius,
    // The list's last row and the rail's last button stay inside the round corner.
    overflow: 'clip',
    // Vertical drags scroll the list and pinches zoom; sideways ones push the drawer back.
    touchAction: 'pan-y pinch-zoom',
    transform: 'translateX(-100%)',
    // A layer of its own, also while out (with no transform): when the page restyled under a
    // finger (a long press holds the page's text unselectable), the iOS web view drew the drawer's
    // lists and badges 34 px too high until the finger lifted.
    willChange: 'transform',
    visibility: 'hidden',
    selectors: {
      '[dir=rtl] &': { transform: 'translateX(100%)' },
      '&[data-open], [dir=rtl] &[data-open]': { transform: 'none', visibility: 'visible' },
      '&[data-animate]': { transition: `transform ${SLIDE} ${EASE}, visibility 0s ${SLIDE}` },
      '&[data-animate][data-open]': { transition: `transform ${SLIDE} ${EASE}` },
      // A page without a list (Threads, Canvases): the rail alone.
      '&:has(> [data-nav-slot]:empty)': { inlineSize: 'auto' },
    },
  },
]);

/** Where the routed section puts its list; it takes the drawer's width beside the rail. */
export const Slot = style({
  display: 'flex',
  minInlineSize: 0,
  // What the rail leaves of the panel.
  flexGrow: 1,
  selectors: {
    '&:empty': { display: 'none' },
  },
});
