import { globalStyle, style } from '@vanilla-extract/css';
import { color, config } from 'folds';

/** A room row in the lobby: room avatar, name and details, then the open or join control. */
export const RoomItemCard = style({
  position: 'relative',
  paddingBlock: config.space.S300,
  paddingInline: config.space.S400,
});

// On a phone a joined room's name is a button whose hit area covers the whole card, so a tap
// anywhere on it opens the room and the keyboard reaches it as one control named by the room.
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
  WebkitTapHighlightColor: 'transparent',
  outline: 'none',
  selectors: {
    '&::after': { content: '""', position: 'absolute', inset: 0 },
  },
});

globalStyle(`${RoomItemCard}:has(${CardOpener}:focus-visible)`, {
  outline: `2px solid ${color.Primary.Main}`,
  outlineOffset: 2,
});

globalStyle(`${RoomItemCard}:has(${CardOpener}:active)`, {
  backgroundColor: color.SurfaceVariant.ContainerActive,
});

// The menu stays above the card's hit area.
export const CardControls = style({
  position: 'relative',
  zIndex: 1,
});

// The name wraps rather than truncating: on a phone the open button leaves it little room, and
// rooms named alike ("Engineering room 1", "Engineering room 2") differ only at their end.
export const RoomName = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
});

// The topic shares the line with nothing else, so it may take the full width and truncate.
export const RoomProfileTopic = style({
  display: 'block',
  minWidth: 0,
});

export const ErrorNameContainer = style({
  minWidth: 0,
});
