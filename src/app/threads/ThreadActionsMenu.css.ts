import { style } from '@vanilla-extract/css';

// On touch screens the rows scroll inside the menu, leaving its glass rim in place.
export const ThreadMenu = style({
  '@media': {
    '(pointer: coarse)': {
      display: 'flex',
      flexDirection: 'column',
      maxHeight: 'calc(100dvh - 4.5rem)',
    },
  },
});

export const ThreadMenuRows = style({
  '@media': {
    '(pointer: coarse)': {
      minHeight: 0,
      overflowY: 'auto',
      overscrollBehavior: 'contain',
    },
  },
});
