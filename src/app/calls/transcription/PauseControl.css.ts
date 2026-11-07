import { style } from '@vanilla-extract/css';

// Held by a finger, it neither scrolls the page nor opens a callout or a text selection.
export const HoldControl = style({
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
});
