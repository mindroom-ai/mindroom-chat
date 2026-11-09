import { style } from '@vanilla-extract/css';

// On a touch screen the menu scrolls when its rows outgrow the window (a phone's room menu also
// holds what its header leaves out). Its rows keep the height of a message's menu rows.
export const RoomMenu = style({
  '@media': {
    '(pointer: coarse)': {
      maxHeight: 'calc(100dvh - 4.5rem)',
      overflowY: 'auto',
      overscrollBehavior: 'contain',
    },
  },
});
