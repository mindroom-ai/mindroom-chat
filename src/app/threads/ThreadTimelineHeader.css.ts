import { globalStyle, style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { headerInset } from '../ui/styles/RoomOverlay.css';
import {
  HEADER_OUT_OF_PADDING,
  THREAD_HEADER_ATTRIBUTE,
  THREAD_HEADER_SCROLLER_ATTRIBUTE,
} from '../ui/styles/threadHeaderInset';

const headerHeight = 'var(--room-thread-header-height, 0px)';

/**
 * The sticky header that holds a thread's banner. The scroller's top padding keeps the rows a
 * browser brings into view clear of the banner, but it covers the banner too: a control focused
 * in it (by Tab, or as a dialog hands focus back) looked hidden, and the browser scrolled the
 * thread to show it, about 380 px in Chromium, which centers it, and 90 px in WebKit. The header
 * is stuck in view, so everything in it is revealed one header height further down, past the
 * padding, which needs no scrolling.
 *
 * Folds' `<Scroll size="300">` reserves an 8 px (`0.5rem` / `S200`) inline-end gutter when native
 * scrollbars are hidden (`data-y-scrollbar-width="0"`), keeping message rows and hover toolbars
 * clear of `InsetScrollbar`. Because `ThreadTimelineHeader` sits above `InsetScrollbar` (whose
 * track starts below the header), reaching across that gutter makes the banner's inline-start and
 * inline-end gaps symmetric (12 px / `S300` on both sides) and keeps `GapAbove` edge-to-edge in
 * side-panel mode without introducing horizontal overflow (`scrollWidth === clientWidth`).
 */
export const Header = style({
  selectors: {
    '[data-y-scrollbar-width="0"] &': {
      marginInlineEnd: `calc(-1 * ${config.space.S200})`,
    },
  },
});

/**
 * Beside the room's messages no room header sits above the banner, so it keeps the gap it has at
 * its start. The column's own surface (the page's, `ContainerColor` Surface) fills the gap, where
 * the messages scrolling past would otherwise show cut in half. Measured with the banner, it counts
 * in the scroll padding too.
 */
export const GapAbove = style({
  paddingTop: config.space.S300,
  background: `linear-gradient(${color.Surface.Container}, ${color.Surface.Container}) top / 100% ${config.space.S300} no-repeat`,
});

globalStyle(`${Header} *`, {
  scrollMarginTop: `calc(-1 * ${headerHeight})`,
  scrollMarginBottom: headerHeight,
});

/**
 * Typing in a field of the header (the banner's title) reveals the caret after each key, and a
 * caret, unlike a focused element, ignores the scroll margin above. It sat in the scroll padding,
 * so every key scrolled the thread up by the distance to the padding's edge (about 70 px), and the
 * stuck header kept the caret there for the next key. While such a field has the focus, the
 * padding leaves the header out; it overrides the padding the header writes inline. It also sets
 * a flag, by which `readTopInset`, what reads the padding as the top of the reader's view, adds the
 * header back. A browser without `:has()` applies neither.
 */
globalStyle(
  `[${THREAD_HEADER_SCROLLER_ATTRIBUTE}]:has([${THREAD_HEADER_ATTRIBUTE}] :is(input, textarea, [contenteditable]:not([contenteditable="false"])):focus)`,
  {
    scrollPaddingTop: `${headerInset} !important`,
    vars: { [HEADER_OUT_OF_PADDING]: '1' },
  }
);
