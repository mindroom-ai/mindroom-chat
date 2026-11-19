import type { CSSProperties } from 'react';
import { createVar, globalStyle, style } from '@vanilla-extract/css';
import { config } from 'folds';
import { Viewport } from '../InsetScrollbar.css';
import { glassFlat, glassFloating, glassSurface } from './Glass.css';
import { shortViewport } from './shortViewport';

// Measured once per layout change, shared by scroll padding and floating controls.
export const headerInset = 'var(--room-header-height, 0px)';
export const footerInset = 'var(--room-footer-height, 0px)';
export const overviewInset = 'var(--room-overview-height, 0px)';
/**
 * For the container of a room's rows or cards, which reads no inset. The room's box sets the
 * overview inset for its whole view, and a custom property is inherited: without a fixed value
 * here, every change of the filter bar's height would restyle each row and card below. A new
 * reader of the inset must not render inside the Compact card list or the room's virtual inner
 * list, where it would read this constant (RoomOverlay.readers.test.ts lists the readers).
 */
export const overviewInsetStop = { '--room-overview-height': '0px' } as CSSProperties;
export const topInset = `calc(${headerInset} + ${overviewInset})`;
export const controlsTopInset = `calc(${topInset} + var(--room-thread-header-height, 0px))`;

// The header's row and what plugins show under it share one surface: the frosted flat chrome the
// conversation scrolls under.
export const Header = style([
  glassSurface({ level: 'panel', variant: 'Surface' }),
  glassFlat,
  glassFloating,
  { position: 'absolute', inset: '0 0 auto', zIndex: 6 },
]);
// The thread banner already offers the way back, so on short screens it is the
// only bar; the room header returns once the thread closes.
export const HeaderInThread = style({ '@media': { [shortViewport]: { display: 'none' } } });
// The gap the footer keeps below the composer: 12 px, 8 px on a phone and on a short screen.
const footerGap = createVar();
// Of the bottom safe area of an iPhone or iPad, what the composer keeps below it: the home
// indicator's 13 px and a pixel.
const homeIndicatorClearance = '14px';
// The footer ends above the bottom safe area, which holds system buttons on Android. Over an
// iPhone's or iPad's home indicator, the composer reaches into it instead, down to 14 px above the
// screen's edge, so it sits low without meeting the indicator. It shares the z-index of the
// dock of jobs and approvals above it and comes after it, so what rises from the composer, such
// as its suggestions, covers the dock. The conversation scrolls on beneath it and its gap: only
// its children take clicks.
export const Footer = style({
  vars: { [footerGap]: config.space.S300 },
  position: 'absolute',
  inset: 'auto 0 0',
  zIndex: 5,
  pointerEvents: 'none',
  paddingBottom: `max(${footerGap}, env(safe-area-inset-bottom, 0px))`,
  // Only iOS WebKit has the property.
  '@supports': {
    '(-webkit-touch-callout: none)': {
      paddingBottom: `max(${footerGap}, min(env(safe-area-inset-bottom, 0px), ${homeIndicatorClearance}))`,
    },
  },
  '@media': { [shortViewport]: { vars: { [footerGap]: config.space.S200 } } },
});
export const FooterOnPhone = style({ vars: { [footerGap]: config.space.S200 } });
globalStyle(`${Footer} > *`, { pointerEvents: 'auto' });
// The dock's row: the typing strip and the background jobs bar (`DockBars`) and, at its end,
// who has read the latest message. Only the strip, the bar and the names take clicks, so the
// timeline beside them stays usable.
export const DockRow = style({
  display: 'flex',
  alignItems: 'end',
  columnGap: config.space.S300,
  paddingInline: config.space.S400,
  pointerEvents: 'none',
});
// The typing strip and the background jobs bar share a line when the conversation is wide
// enough: the strip first, as wide as its text, the bar taking the rest. Too narrow for both,
// the bar wraps above the strip, and each spans the line.
export const DockBars = style({
  position: 'relative',
  display: 'flex',
  flex: '1 1 auto',
  flexWrap: 'wrap-reverse',
  alignItems: 'end',
  columnGap: config.space.S300,
  minWidth: 0,
  pointerEvents: 'none',
});
globalStyle(`${DockBars} > *`, { pointerEvents: 'auto' });
export const Overview = style({
  position: 'absolute',
  insetInline: 0,
  top: headerInset,
  zIndex: 5,
  display: 'flow-root',
});
export const Scroll = style([
  Viewport,
  {
    scrollPaddingTop: topInset,
    scrollPaddingBottom: footerInset,
  },
]);
export const Scrollbar = style({ top: controlsTopInset, bottom: footerInset, zIndex: 3 });
