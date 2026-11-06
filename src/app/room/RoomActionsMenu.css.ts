import { globalStyle, style } from '@vanilla-extract/css';

// On a touch screen each row of a room's menu is a full 44 px target, and the menu scrolls when
// its rows outgrow the window (a phone's room menu also holds what its header leaves out).
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
