import { globalStyle, style } from '@vanilla-extract/css';

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

globalStyle(`${Header} *`, {
  scrollMarginTop: `calc(-1 * ${headerHeight})`,
  scrollMarginBottom: headerHeight,
});
