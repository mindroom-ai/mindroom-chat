import { style } from '@vanilla-extract/css';

// The rows scroll inside the menu, leaving its glass rim in place on every pointer type.
export const ThreadMenu = style({
  display: 'flex',
  flexDirection: 'column',
  maxHeight: 'calc(100dvh - 4.5rem)',
});

export const ThreadMenuRows = style({
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
});
