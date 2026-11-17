import { style } from '@vanilla-extract/css';

// The rows scroll inside the menu, leaving its glass rim in place on every pointer type. The cap
// leaves out the safe areas, so the popout's clamp can keep the whole menu clear of them.
export const ThreadMenu = style({
  display: 'flex',
  flexDirection: 'column',
  maxHeight:
    'calc(100dvh - 4.5rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
});

export const ThreadMenuRows = style({
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
});

// As the hover card, details that all render nothing leave no padded group or divider.
export const ThreadMenuDetails = style({
  selectors: {
    '&:not(:has([data-thread-detail]:not(:empty)))': { display: 'none' },
  },
});
