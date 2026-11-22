import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

// The rows scroll inside the menu, leaving its glass rim in place on every pointer type. The cap
// leaves out the safe areas, so the popout's clamp can keep the whole menu clear of them.
export const ThreadMenu = style({
  display: 'flex',
  flexDirection: 'column',
  maxHeight:
    'calc(100dvh - 4.5rem - var(--app-inset-top, env(safe-area-inset-top, 0px)) - env(safe-area-inset-bottom, 0px))',
});

export const ThreadMenuRows = style({
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
});

// The tags at the menu's top hold the focus while a removed tag goes: their ring follows the menu's
// top corners, inside its edge.
export const ThreadMenuTags = style({
  borderStartStartRadius: config.radii.R500,
  borderStartEndRadius: config.radii.R500,
  outline: 'none',
  selectors: {
    '&:focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: '-2px' },
  },
});

// As the hover card, details that all render nothing leave no padded group or divider.
export const ThreadMenuDetails = style({
  selectors: {
    '&:not(:has([data-thread-detail]:not(:empty)))': { display: 'none' },
  },
});
