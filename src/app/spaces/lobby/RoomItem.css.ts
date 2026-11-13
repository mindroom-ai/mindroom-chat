import { globalStyle, style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { ENABLED_CARD_ACTION } from '../../lib/cardAction';

/** A room row in the lobby: room avatar, name and details, then the open or join control. */
export const RoomItemCard = style({
  paddingBlock: config.space.S300,
  paddingInline: config.space.S400,
  selectors: {
    '&[data-opens-by-card]': { cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
    '&[data-opens-by-card]:active': { backgroundColor: color.SurfaceVariant.ContainerActive },
    // A room the person is not in joins (or asks to join) from a click anywhere on its card.
    [`&:has(${ENABLED_CARD_ACTION})`]: {
      cursor: 'pointer',
      WebkitTapHighlightColor: 'transparent',
    },
    [`&:has(${ENABLED_CARD_ACTION}):active`]: {
      backgroundColor: color.SurfaceVariant.ContainerActive,
    },
  },
});

// On a phone a joined room's name is the button the keyboard reaches the card by; a tap anywhere
// on the card opens the room too (RoomItemCard's click handler). Its focus ring is the card's.
export const CardOpener = style({
  display: 'block',
  minWidth: 0,
  padding: 0,
  border: 0,
  background: 'none',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'start',
  cursor: 'pointer',
  outline: 'none',
});

globalStyle(`${RoomItemCard}:has(${CardOpener}:focus-visible)`, {
  outline: `2px solid ${color.Primary.Main}`,
  outlineOffset: 2,
});

// The name wraps rather than truncating: on a phone a join button beside it leaves it little room,
// and rooms named alike ("Engineering room 1", "Engineering room 2") differ only at their end.
export const RoomName = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
});

// The topic shares the line with nothing else, so it may take the full width and truncate.
export const RoomProfileTopic = style({
  display: 'block',
  minWidth: 0,
});

// The row that holds the name, or for a joined room on a phone the button around it.
export const RoomNameRow = style({
  minWidth: 0,
});
