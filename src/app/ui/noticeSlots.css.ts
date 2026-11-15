import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';
import { noticeMotionFromAbove, noticeMotionFromBelow } from './noticeMotion.css';
import { glassShadow } from './styles/Glass.css';

// Empty, the places have no size or take no clicks, so they cover nothing.

// At the foot of the room list, over its last rows, inside the list's resizable panel. A notice
// keeps the width of the list's content (ResizablePanel's --mr-panel-content-width) at the end
// edge, and the place clips it at the panel's sides, so while the list opens, closes or is dragged
// narrow the notice slides with the list instead of squeezing. No inline padding, so the place is
// never wider than the panel; a notice keeps its own distance from the sides. The place stacks
// its notices a gap apart, the new version notice at the foot and the tour's offer above it (the
// new version notice's `order`), so the one at the foot stays put when the other comes or goes.
export const ListSlot = style({
  position: 'absolute',
  // Over the list's scrollbar (z-index 2, earlier in the panel), so the card takes its own taps.
  zIndex: 2,
  insetInline: 0,
  insetBlockEnd: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: config.space.S200,
  paddingBlockStart: config.space.S300,
  paddingBlockEnd: `calc(env(safe-area-inset-bottom, 0px) + ${config.space.S300})`,
  overflowX: 'clip',
  pointerEvents: 'none',
});

// The page's place stacks its notices a gap apart: the new version notice, the tour's offer, then
// a sync status (their own `order`). One that comes or goes moves only those under it, and the
// sync status, which takes no taps, is the last.
export const PageSlot = recipe({
  base: { display: 'flex', flexDirection: 'column', gap: config.space.S200 },
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
        blockSize: 0,
        zIndex: 1,
        flexShrink: 0,
        insetBlockStart: config.space.S200,
        paddingInline: config.space.S200,
      },
    },
  },
});

// What the cards of the places share (the new version notice and the tour's offer), for their
// own styles to build on.

/** A notice card: its padding and corners, and the clicks its place leaves to it. */
export const noticeCard = {
  gap: config.space.S300,
  padding: config.space.S300,
  pointerEvents: 'auto',
  borderRadius: config.radii.R500,
} as const;

const listEndGap = `max(${config.space.S200}, var(--mr-panel-handle-inset, 0px))`;

/** A card in the room list's place: as wide as the list's content, coming in from below. */
export const noticeCardInList = {
  ...noticeMotionFromBelow,
  flexShrink: 0,
  // Clear of the splitter, which reaches --mr-panel-handle-inset at most into the list.
  inlineSize: `calc(var(--mr-panel-content-width, 100%) - ${config.space.S200} - ${listEndGap})`,
  marginInlineStart: config.space.S200,
  marginInlineEnd: listEndGap,
  // Its place clips it at the list's sides, S200 away: a shadow that ends within them.
  selectors: {
    ...noticeMotionFromBelow.selectors,
    '&&&': { vars: { [glassShadow]: `0 ${toRem(2)} ${toRem(6)} ${color.Other.Shadow}` } },
  },
} as const;

/**
 * A card in the page's place, coming in from above: as wide as it needs up to a width of its own
 * (`maxInlineSize`), and across the page on a phone.
 */
export const noticeCardOnPage = {
  ...noticeMotionFromAbove,
  // A phone's place has no height of its own: the card keeps the height of its content.
  flexShrink: 0,
  selectors: {
    ...noticeMotionFromAbove.selectors,
    // A phone's place spans the page, and so does the card.
    '[data-phone] > &': { maxInlineSize: 'none' },
  },
} as const;

/** A card's mark, in an accent tile. */
export const noticeMark = {
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  inlineSize: toRem(28),
  blockSize: toRem(28),
  borderRadius: config.radii.R400,
  backgroundColor: color.Primary.Container,
  color: color.Primary.Main,
} as const;
