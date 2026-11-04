import { style } from '@vanilla-extract/css';

// One absolutely placed row of a virtual list; its top comes from the virtualizer.
export const VirtualTile = style({
  position: 'absolute',
  insetInlineStart: 0,
  width: '100%',
});
