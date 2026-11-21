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
  paddingLeft: 'env(safe-area-inset-left, 0px)',
  paddingRight: 'env(safe-area-inset-right, 0px)',
});

globalStyle(`${MobileOverlay} > *`, { pointerEvents: 'auto' });

// The notice sits beside the drawer, not between the drawer and the edge of the viewport.
globalStyle(`${MobileOverlay} > [data-dialog-notice-slot]`, { alignSelf: 'flex-start', order: -1 });
