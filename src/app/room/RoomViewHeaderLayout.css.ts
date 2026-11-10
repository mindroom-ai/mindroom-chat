import { style } from '@vanilla-extract/css';
import { toRem } from 'folds';
import { shortViewport } from '../ui/styles/shortViewport';

export const Header = style({
  '@media': { [shortViewport]: { selectors: { '&&': { height: toRem(44) } } } },
});

export const Topic = style({
  '@media': { [shortViewport]: { selectors: { '&&': { display: 'none' } } } },
});

/** Where a phone's thread bar goes, in the room name's place (RoomViewHeader `threadBarSlot`). */
export const ThreadBarSlot = style({
  flexGrow: 1,
  minWidth: 0,
  alignSelf: 'stretch',
  display: 'flex',
  alignItems: 'center',
});
