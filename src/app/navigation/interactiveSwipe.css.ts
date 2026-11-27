import { globalStyle } from '@vanilla-extract/css';

// While a surface is actively tracking a finger, inline `translate`/`opacity` drive it frame-by-frame
// with zero CSS transition lag.
globalStyle('[data-swiping]', {
  transition: 'none !important',
});

// Casts an iOS-style 16 px leading-edge shadow on the upper surface during an interactive swipe or
// live slide without allocating a clip-path mask IOSurface or bleeding onto top/bottom bars.
globalStyle('[data-swipe-shadow]::before', {
  content: '""',
  position: 'absolute',
  insetBlock: 0,
  insetInlineStart: '-16px',
  inlineSize: '16px',
  pointerEvents: 'none',
  background: 'linear-gradient(to left, rgb(0 0 0 / 0.16), transparent)',
});

globalStyle('[dir="rtl"] [data-swipe-shadow]::before, [data-swipe-shadow][dir="rtl"]::before', {
  background: 'linear-gradient(to right, rgb(0 0 0 / 0.16), transparent)',
});
