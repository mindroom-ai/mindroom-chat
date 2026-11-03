import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config, toRem } from 'folds';

// Measured from docs/design/reference/home.png and room-light.png (1440x900 at 1x): the
// navigation column runs from the 66 px rail to the divider at x = 321, so it is 256 px wide; its
// header is folds Header size 600 (3.375rem, 54 px) with the title 12 px in (S300) and the menu
// button 16 px from the divider (S400); rows start 8 px below the header and 8 px from the rail
// (S200) and are 36 px apart (the row component). Everything else uses folds spacing tokens.

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
  padding: `0 ${config.space.S400} 0 ${config.space.S300}`,
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

/** The inset scrollbar of a navigation column, between its 54 px header and the bottom edge. */
export const PageNavScrollbar = style({ top: toRem(58), bottom: toRem(4), zIndex: 2 });

// Top S200, flush right against the scrollbar, room at the bottom, rows S200 from the rail.
export const PageNavContent = style({
  minHeight: '100%',
  paddingBlock: `${config.space.S200} ${config.space.S700}`,
  paddingLeft: config.space.S200,
});

/** Page headers sit S400 in on the title side and S200 at the actions; `balance` evens both. */
export const PageHeader = recipe({
  base: { flexShrink: 0, paddingRight: config.space.S200 },
  variants: {
    balance: {
      false: { paddingLeft: config.space.S400 },
      true: { paddingLeft: config.space.S200 },
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
