import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { config } from 'folds';

// Empty, the places have no size or take no clicks, so they cover nothing.

// At the foot of the room list, over its last rows, inside the list's resizable panel. Its notice
// keeps the width of the list's content (ResizablePanel's --mr-panel-content-width) at the end
// edge, and the place clips it at the panel's sides, so while the list opens, closes or is dragged
// narrow the notice slides with the list instead of squeezing. No inline padding, so the place is
// never wider than the panel; the notice keeps its own distance from the sides.
export const ListSlot = style({
  position: 'absolute',
  // Over the list's scrollbar (z-index 2, earlier in the panel), so the card takes its own taps.
  zIndex: 2,
  insetInline: 0,
  insetBlockEnd: 0,
  display: 'flex',
  justifyContent: 'flex-end',
  paddingBlockStart: config.space.S300,
  paddingBlockEnd: `calc(env(safe-area-inset-bottom, 0px) + ${config.space.S300})`,
  overflowX: 'clip',
  pointerEvents: 'none',
});

// The page's place stacks its notices, the new version notice above a sync status (their own
// `order`, so the notice someone may tap never moves when the other comes or goes), a gap apart.
export const PageSlot = recipe({
  base: {
    display: 'flex',
    flexDirection: 'column',
    gap: config.space.S200,
  },
  variants: {
    phone: {
      // Over the top of the page, centred: placed against the signed-in layout (or, signed out,
      // against the top of the app), so whatever sits above it moves it along.
      false: {
        position: 'absolute',
        // Above the pages, below folds' dialogs, menus and tooltips in their own layer.
        zIndex: 1000,
        insetBlockStart: config.space.S300,
        insetInline: config.space.S300,
        alignItems: 'center',
        pointerEvents: 'none',
      },
      // A line of no height between the top bar and the page, which its notices hang from, S200
      // below it and across the page. At z-index 1 it paints over the page (an isolated layer,
      // painted as z-index 0), and the drawer and a room's members sheet, at z-index 1 later in
      // the page, slide in over it.
      true: {
        position: 'relative',
        zIndex: 1,
        flexShrink: 0,
        blockSize: 0,
        insetBlockStart: config.space.S200,
        paddingInline: config.space.S200,
      },
    },
  },
});
