import { style } from '@vanilla-extract/css';

// On a touch screen the rows scroll when they outgrow the window (a phone's room menu also holds
// what its header leaves out). They scroll inside the menu, whose glass rim stays put around them,
// and keep the height of a message's menu rows. The cap leaves out the safe areas, so the popout's
// clamp can keep the whole menu clear of them.
export const RoomMenu = style({
  '@media': {
    '(pointer: coarse)': {
      display: 'flex',
      flexDirection: 'column',
      maxHeight:
        'calc(100dvh - 4.5rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
    },
  },
});

export const RoomMenuRows = style({
  '@media': {
    '(pointer: coarse)': {
      minHeight: 0,
      overflowY: 'auto',
      overscrollBehavior: 'contain',
    },
  },
});
