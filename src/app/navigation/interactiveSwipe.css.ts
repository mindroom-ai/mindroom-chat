import { globalStyle } from '@vanilla-extract/css';

// While a surface is actively tracking a finger, inline `translate`/`opacity` drive it frame-by-frame
// with zero CSS transition lag.
globalStyle('[data-swiping]', {
  transition: 'none !important',
});

// Casts an iOS-style side edge shadow on the upper surface during an interactive swipe without
// bleeding onto top/bottom bars.
globalStyle('[data-swipe-shadow]', {
  boxShadow: '0 0 24px rgb(0 0 0 / 0.24) !important',
  clipPath: 'inset(0 -48px)',
});
