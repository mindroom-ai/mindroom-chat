import { globalStyle, style } from '@vanilla-extract/css';

// On a touch screen the room menu also holds what a phone's header leaves out, so each row is a
// full 44 px target and the menu scrolls when the rows outgrow the window below the header.
const touch = '(pointer: coarse)';

export const RoomMenu = style({
  '@media': {
    [touch]: {
      maxHeight: 'calc(100dvh - 4.5rem)',
      overflowY: 'auto',
      overscrollBehavior: 'contain',
    },
  },
});

globalStyle(`${RoomMenu} :is([role="menuitem"], [role="menuitemcheckbox"])`, {
  '@media': { [touch]: { minHeight: '44px' } },
});
