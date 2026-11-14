import type { CSSProperties } from 'react';
import { globalStyle, style } from '@vanilla-extract/css';
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
// Read receipts give way to messages on short screens, where the footer keeps a small gap
// below the composer. The footer ends above the home indicator: its safe area stays outside
// the composer's box. It shares the z-index of the dock of jobs and approvals above it and
// comes after it, so what rises from the composer, such as its suggestions, covers the dock.
export const Footer = style({
  position: 'absolute',
  inset: 'auto 0 0',
  zIndex: 5,
  pointerEvents: 'none',
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  '@media': {
    [shortViewport]: {
      paddingBottom: `max(${config.space.S200}, env(safe-area-inset-bottom, 0px))`,
    },
  },
});
globalStyle(`${Footer} > *`, { pointerEvents: 'auto' });
export const Following = style({ '@media': { [shortViewport]: { display: 'none' } } });
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
