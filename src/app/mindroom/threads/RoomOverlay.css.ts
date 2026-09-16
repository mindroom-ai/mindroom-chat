import { globalStyle, style } from '@vanilla-extract/css';

// Measured once per layout change, shared by scroll padding and floating controls.
export const headerInset = 'var(--room-header-height, 0px)';
export const footerInset = 'var(--room-footer-height, 0px)';
export const overviewInset = 'var(--room-overview-height, 0px)';
export const topInset = `calc(${headerInset} + ${overviewInset})`;
export const controlsTopInset = `calc(${topInset} + var(--room-thread-header-height, 0px))`;

export const Header = style({ position: 'absolute', inset: '0 0 auto', zIndex: 6 });
export const Footer = style({
  position: 'absolute',
  inset: 'auto 0 0',
  zIndex: 4,
  pointerEvents: 'none',
});
globalStyle(`${Footer} > *`, { pointerEvents: 'auto' });
export const Overview = style({
  position: 'absolute',
  insetInline: 0,
  top: headerInset,
  zIndex: 5,
  display: 'flow-root',
});
export const Scroll = style({
  scrollPaddingTop: topInset,
  scrollPaddingBottom: footerInset,
});
