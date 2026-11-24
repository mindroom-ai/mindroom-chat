import { style } from '@vanilla-extract/css';
import { DefaultReset, color, toRem } from 'folds';
import { motion } from '../ui/styles/Motion.css';

// The navigation drawer's motion (`PhoneNavDrawer.css.ts`), from the other edge; reduced motion
// collapses it app-wide (src/index.css).
const SLIDE = motion.duration.Slower;
const EASE = motion.easing.Standard;

/** The scrim and the sheet as one layer, with no box of its own. */
export const Layer = style({ display: 'contents' });

/** Dims the page beside the sheet; a tap on it puts the sheet away. */
export const Scrim = style([
  DefaultReset,
  {
    position: 'absolute',
    inset: 0,
    backgroundColor: color.Other.Overlay,
    opacity: 0,
    // While it fades out, taps already reach the page below it.
    pointerEvents: 'none',
    transition: `opacity ${SLIDE} ${EASE}`,
    selectors: {
      '&[data-open]': { opacity: 1, pointerEvents: 'auto' },
      '&[data-swiping]': { transition: 'none !important' },
    },
  },
]);

/**
 * The sheet, as wide as the drawer: off screen past the end edge until it is out. Like the drawer,
 * it rounds its one free lower corner to 28 px: the top meets the bar and the other edges meet the
 * screen.
 */
export const Panel = style([
  DefaultReset,
  {
    position: 'absolute',
    insetBlock: 0,
    insetInlineEnd: 0,
    display: 'flex',
    // Its notice place (ui/noticeSlots.tsx) over the members.
    flexDirection: 'column',
    inlineSize: 'min(calc(100% - 56px), 420px)',
    backgroundColor: color.Background.Container,
    boxShadow: `0 0 24px ${color.Other.Shadow}`,
    // Cast the shadow to the side only, never upward onto the top bar.
    clipPath: 'inset(0 -48px)',
    borderEndStartRadius: toRem(28),
    // The last member rows stay inside the round corner.
    overflow: 'clip',
    // The last members clear the home indicator.
    paddingBlockEnd: 'env(safe-area-inset-bottom, 0px)',
    pointerEvents: 'auto',
    // It may take the focus as it opens, as a dialog does; its rows show where the focus goes next.
    outline: 'none',
    // Vertical drags scroll the list and pinches zoom; sideways ones push the sheet back.
    touchAction: 'pan-y pinch-zoom',
    transform: 'translateX(100%)',
    transition: `transform ${SLIDE} ${EASE}`,
    selectors: {
      '[dir=rtl] &': { transform: 'translateX(-100%)' },
      '&[data-open], [dir=rtl] &[data-open]': { transform: 'none' },
      '&[data-swiping]': { transition: 'none !important' },
    },
  },
]);

/** The members, in the height the sheet's notice place leaves. */
export const Members = style({ display: 'flex', flexGrow: 1, minBlockSize: 0 });
