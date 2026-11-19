import { globalStyle, style } from '@vanilla-extract/css';
import { color, config } from 'folds';

const headerHeight = 'var(--room-thread-header-height, 0px)';

/**
 * The sticky header that holds a thread's banner. The scroller's top padding keeps the rows a
 * browser brings into view clear of the banner, but it covers the banner too: a control focused
 * in it (by Tab, or as a dialog hands focus back) looked hidden, and the browser scrolled the
 * thread to show it, about 380 px in Chromium, which centers it, and 90 px in WebKit. The header
 * is stuck in view, so everything in it is revealed one header height further down, past the
 * padding, which needs no scrolling.
 */
export const Header = style({});

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
