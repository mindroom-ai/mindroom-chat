import { createVar, style } from '@vanilla-extract/css';
import { shortViewport } from '../../ui/styles/shortViewport';

// The rail's part above its foot group (SidebarContent's `scrollable`). Pinned, the top group
// stays put and only the part below it scrolls; unpinned, the whole part scrolls as one column.
// The same two boxes serve both layouts, so switching moves nothing into another parent.

/** How far the fade at a scrolling edge reaches, and how far a revealed entry stays from it. */
const fadeLength = '1rem';
const fadeStart = createVar();
const fadeEnd = createVar();
const fadeMask = `linear-gradient(to bottom, transparent, #000 ${fadeStart}, #000 calc(100% - ${fadeEnd}), transparent)`;

/**
 * A scroller shows no scrollbar; it still scrolls by wheel, touch and keyboard focus. A
 * scrollbar would take width from one side, moving the centred entries off the foot group's
 * centre line and their indicators past the scroller's edge, which clips them. Chromium follows
 * the app-wide `scrollbar-width: thin` unless told otherwise. While there is more to scroll
 * toward an edge, the entries fade out toward it.
 */
const scroller = {
  overflowX: 'hidden',
  overflowY: 'auto',
  scrollbarWidth: 'none',
  scrollPaddingBlock: fadeLength,
  maskImage: fadeMask,
  WebkitMaskImage: fadeMask,
} as const;

/**
 * The whole part. Unpinned, it is the scroller. `data-more-above` and `data-more-below` say
 * whichever box scrolls has more to show that way.
 */
export const RailScrollArea = style({
  flex: '1 1 0',
  minBlockSize: 0,
  display: 'flex',
  flexDirection: 'column',
  vars: { [fadeStart]: '0px', [fadeEnd]: '0px' },
  selectors: {
    '&[data-more-above]': { vars: { [fadeStart]: fadeLength } },
    '&[data-more-below]': { vars: { [fadeEnd]: fadeLength } },
    '&:not([data-pinned])': scroller,
    '&:not([data-pinned])::-webkit-scrollbar': { display: 'none' },
    '&[data-pinned]': { overflow: 'hidden' },
  },
  '@media': {
    // A phone in landscape scrolls the whole rail (SidebarScrollPart): this part takes its full
    // height and does not scroll or fade on its own.
    [shortViewport]: {
      selectors: {
        '&&&': { flex: 'none', overflow: 'visible', maskImage: 'none', WebkitMaskImage: 'none' },
      },
    },
  },
});

/** The top group: Home, Direct Messages, Activity, Threads and Canvases. */
export const RailScrollTop = style({ flexShrink: 0 });

/** The spaces, then Explore and Create Space. Pinned, it is the scroller. */
export const RailScrollRest = style({
  flexShrink: 0,
  selectors: {
    [`${RailScrollArea}[data-pinned] > &`]: { ...scroller, flex: '1 1 0', minBlockSize: 0 },
    [`${RailScrollArea}[data-pinned] > &::-webkit-scrollbar`]: { display: 'none' },
  },
  '@media': {
    [shortViewport]: {
      selectors: {
        [`${RailScrollArea}[data-pinned] > &&`]: {
          flex: 'none',
          overflow: 'visible',
          maskImage: 'none',
          WebkitMaskImage: 'none',
        },
      },
    },
  },
});
