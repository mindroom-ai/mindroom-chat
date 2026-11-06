import { createVar, fallbackVar, globalStyle, style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';
import { SCROLL_HEADER_HEIGHT_PROPERTY, scrollHeaderHeight } from './scrollHeaderInset';

// Measured from docs/design/reference/home.png and room-light.png (1440x900 at 1x): the
// navigation column runs from the 66 px rail to the divider at x = 321, so it is 256 px wide; its
// header is folds Header size 600 (3.375rem, 54 px) with the title 12 px in (S300) and the menu
// button 16 px from the divider (S400); rows start 8 px below the header and 8 px from the rail
// (S200) and are 36 px apart (the row component). Everything else uses folds spacing tokens.

/**
 * How far list rows stop short of the column's end edge, leaving the inset scrollbar its lane:
 * 28 px in the room lists (the selected room of room-light.png spans 74 to 294 in a column that
 * ends at 322). Dense columns, the settings dialogs, keep 8 px, as at their start.
 */
const pageNavRowInset = createVar();

export const PageNav = recipe({
  base: {
    flexShrink: 0,
    height: '100%',
    width: '100%',
    minHeight: 0,
  },
  variants: {
    size: {
      '400': { width: toRem(256) },
      // A narrower column for dense layouts; no reference screenshot shows it.
      '300': { width: toRem(222) },
    },
  },
  defaultVariants: { size: '400' },
});

export const PageNavHeader = style({
  paddingBlock: 0,
  paddingInline: `${config.space.S300} ${config.space.S400}`,
  flexShrink: 0,
  selectors: {
    'button&': { cursor: 'pointer' },
    'button&[aria-pressed=true]': { backgroundColor: color.Background.ContainerActive },
    'button&:hover, button&:focus-visible': { backgroundColor: color.Background.ContainerHover },
    'button&:active': { backgroundColor: color.Background.ContainerActive },
  },
});

/** A navigation header that scrolls with the list below it. */
export const PageNavHeaderScroll = style({ position: 'sticky', top: 0, zIndex: 1 });

/**
 * The scrollbar of a navigation list. A resizable column's splitter covers the last pixels of
 * the column (`--mr-panel-handle-inset`), so the track keeps clear of it there.
 */
export const PageNavTrack = style({});
globalStyle(`:has(> [role="separator"][aria-orientation="vertical"]) > * ${PageNavTrack}`, {
  insetInlineEnd: `calc(var(--mr-panel-handle-inset, 0px) + ${toRem(2)})`,
});

/** The inset scrollbar of a navigation column, between its 54 px header and the bottom edge. */
export const PageNavScrollbar = style({ top: toRem(58), bottom: toRem(4), zIndex: 2 });

/** A dense navigation column: its rows end 8 px before the divider, as far as they start in. */
export const PageNavDense = style({ vars: { [pageNavRowInset]: config.space.S200 } });

// Top S200, room at the bottom, rows S200 from the rail and short of the scrollbar at the end.
export const PageNavContent = style({
  display: 'flex',
  flexDirection: 'column',
  paddingBlock: `${config.space.S200} ${config.space.S700}`,
  paddingInlineStart: config.space.S200,
  paddingInlineEnd: fallbackVar(
    pageNavRowInset,
    `calc(${config.space.S500} + ${config.space.S200})`
  ),
});

/** Page headers sit S400 in on the title side and S200 at the actions; `balance` evens both. */
export const PageHeader = recipe({
  base: { flexShrink: 0, paddingInlineEnd: config.space.S200 },
  variants: {
    balance: {
      false: { paddingInlineStart: config.space.S400 },
      true: { paddingInlineStart: config.space.S200 },
    },
    outlined: {
      true: { borderBottom: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}` },
    },
  },
  defaultVariants: { balance: false },
});

// Page bodies: S400 around the content, more room under the last item.
export const PageContent = style([
  DefaultReset,
  {
    paddingTop: config.space.S400,
    paddingInline: config.space.S400,
    paddingBottom: config.space.S700,
  },
]);

// A column that fills the space up to `max` and centers itself in what is left.
const centeredColumn = (max: string) => ({ width: '100%', maxWidth: max, margin: 'auto' });

// Explore pages center their room grid; three 300 px cards with S400 gaps and padding fit.
export const PageContentCenter = style(centeredColumn(toRem(964)));

// home.png: the welcome block is a 360 px column (logo, title, buttons, backup card).
export const PageHeroSection = style([
  DefaultReset,
  { padding: `${config.space.S700} 0`, ...centeredColumn(toRem(360)) },
]);

// PageScroll: the frame is the scrollbar's positioning box. The viewport inside it stays
// unpositioned, so the track, which sits in the viewport for its accessibility tree, does not
// scroll with the content.
export const PageScroll = style({
  // A nested frame without a title must not inherit its parent's inset.
  vars: { [SCROLL_HEADER_HEIGHT_PROPERTY]: '0px' },
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  minHeight: 0,
  maxHeight: '100%',
});

export const PageScrollViewport = style({
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  minHeight: 0,
  // Focus and scrollIntoView keep their target clear of the title.
  scrollPaddingTop: scrollHeaderHeight,
});

// Above the content and below the scrollbar track.
export const PageScrollHeader = style({
  position: 'sticky',
  insetBlockStart: 0,
  zIndex: 1,
  flexShrink: 0,
});

// Short content still fills the viewport, without adding the title's height to the scroll range.
export const PageScrollContent = style({
  flex: '1 0 auto',
  minWidth: 0,
});

export const PageScrollbar = style({
  top: `calc(${scrollHeaderHeight} + ${toRem(4)})`,
  bottom: toRem(4),
  zIndex: 2,
});
