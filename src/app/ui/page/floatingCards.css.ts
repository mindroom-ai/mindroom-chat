import { style } from '@vanilla-extract/css';

// Markers of the floating cards layout, whose rules are in shell/layout/floatingCardsLayout.css.ts:
// the signed-in shell carries FloatingShell while the content shows as cards, and every page
// carries PageSurface and PageDivider, so the shell can make it a card without the page knowing.

/** The signed-in layout of the rail and the page, while the content shows as cards. */
export const FloatingShell = style({});

/** Marks every page of the client; a page inside another page stays flat. */
export const PageSurface = style({});

/** The divider between the navigation column and the page, which the gap replaces. */
export const PageDivider = style({});
