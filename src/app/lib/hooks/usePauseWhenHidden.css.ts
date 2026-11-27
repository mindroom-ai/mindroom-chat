import { globalStyle } from '@vanilla-extract/css';

// Pause infinite animations on off-screen, hidden-tab, or collapsed-pane elements without
// changing keyframes or visual styling while visible.
globalStyle(
  [
    "[data-animation-paused='true']",
    "[data-animation-paused='true'] *",
    "[data-animation-paused='true']::before",
    "[data-animation-paused='true']::after",
    "[data-animation-paused='true'] *::before",
    "[data-animation-paused='true'] *::after",
  ].join(', '),
  {
    animationPlayState: 'paused !important',
  }
);
