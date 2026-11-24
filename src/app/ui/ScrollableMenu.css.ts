import { style } from '@vanilla-extract/css';

// Rows scroll inside the menu when a tall menu outgrows a short viewport or landscape phone,
// leaving its glass rim in place. The cap leaves out the safe areas, keeping the 4.5rem clearance
// on coarse pointers (matching RoomActionsMenu) so the popout's clamp keeps the whole menu clear
// of them.
export const ScrollableMenu = style({
  display: 'flex',
  flexDirection: 'column',
  maxHeight:
    'calc(100dvh - 1.5rem - var(--app-inset-top, env(safe-area-inset-top, 0px)) - env(safe-area-inset-bottom, 0px))',
  '@media': {
    '(pointer: coarse)': {
      maxHeight:
        'calc(100dvh - 4.5rem - var(--app-inset-top, env(safe-area-inset-top, 0px)) - env(safe-area-inset-bottom, 0px))',
    },
  },
});

export const ScrollableMenuRows = style({
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
});
