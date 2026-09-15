import { globalStyle, style } from '@vanilla-extract/css';

export const MobileOverlay = style({
  position: 'fixed',
  inset: 0,
  display: 'flex',
  justifyContent: 'flex-end',
  pointerEvents: 'none',
  boxSizing: 'border-box',
  paddingTop: 'env(safe-area-inset-top, 0px)',
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
});

globalStyle(`${MobileOverlay} > *`, { pointerEvents: 'auto' });
