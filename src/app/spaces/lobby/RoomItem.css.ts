import { style } from '@vanilla-extract/css';
import { config } from 'folds';

/** A room row in the lobby: room avatar, name and details, then the open or join control. */
export const RoomItemCard = style({
  paddingBlock: config.space.S300,
  paddingInline: config.space.S400,
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
