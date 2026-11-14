import { globalStyle } from '@vanilla-extract/css';
import { color, config } from 'folds';
import {
  FloatingShell,
  PageDivider,
  PageSurface,
  cardRadius,
} from '../../ui/page/floatingCards.css';
import { PageNavContent, PageNavHeader, PageNavTrack } from '../../ui/page/style.css';
import { Handle, Panel } from '../../ui/panels/ResizablePanel.css';
import { MinimapContainer } from '../../timeline/TimelineMinimap.css';
import { RecentlyOpenedPanel } from '../../sidebar/threads/threadNav.css';

// Floating cards: wherever the navigation and the content share the screen, the rail and the room
// list sit on the app background and every page, and every side panel beside a room, is a card
// inset by S200 from the window's edges, from the list and from each other. Dialogs render in a
// portal outside the shell, so their pages stay as they are; phones, also held sideways, keep the
// full-bleed layout. The markers these rules start from are in ui/page/floatingCards.css.ts.

const CARD_GAP = config.space.S200;

const card = {
  // The line is a shadow just outside the card, so it takes no width from what the card holds.
  boxShadow: `0 0 0 ${config.borderWidth.B300} ${color.Background.ContainerLine}`,
  borderRadius: cardRadius,
  backgroundColor: color.Surface.Container,
  // Clips content to the rounded corners without making the card a scroll container, so sticky
  // headers inside keep sticking to their own scrolling areas.
  overflow: 'clip',
} as const;

globalStyle(`${FloatingShell} ${PageSurface}:not(${PageSurface} *)`, {
  ...card,
  margin: CARD_GAP,
});

globalStyle(`${FloatingShell} ${PageDivider}`, { display: 'none' });

// A side panel of a room is a card of the conversation's height, a gap after the conversation. The
// room keeps the gap at its end around the panel, so the panel's card is as wide as the panel. A
// panel inside a page (the room page's thread column) is part of the page's card and stays flat,
// its splitter's line between it and the conversation. The room and the lobby lay out in a panel
// row (`PanelRow`); the rule asks only that row, as any element a `:has()` may match is checked
// again on every change below it, which in a long room is the whole page.
const SIDE_PANEL = `${Panel}[data-side='end']:not(${PageSurface} *)`;
globalStyle(`${FloatingShell} [data-panel-row]:has(> ${SIDE_PANEL})`, {
  paddingInlineEnd: CARD_GAP,
});
globalStyle(`${FloatingShell} ${SIDE_PANEL}`, { paddingBlock: CARD_GAP });
// Expanded, a panel takes the conversation's place, so it keeps the gap on both sides.
globalStyle(`${FloatingShell} ${SIDE_PANEL}[data-filled]`, {
  paddingInlineStart: CARD_GAP,
});
globalStyle(`${FloatingShell} ${SIDE_PANEL} > :first-child`, card);

// The splitters run through the gaps: each handle moves half a gap off its panel's edge, so it and
// its line sit in the middle of the gap, and the line shows only while the splitter is used. A
// splitter inside a page has no gap: it stays on the edge, its line always shown.
const HALF_GAP = `calc(${CARD_GAP} / 2)`;
// With a mouse the handle is exactly the gap, so it takes nothing from the list's scrollbar or the
// cards; touch keeps its wider target.
globalStyle(`${FloatingShell} ${Panel}`, {
  '@media': { '(pointer: fine)': { vars: { '--mr-panel-handle-inset': HALF_GAP } } },
});
const handleOffset = `calc(-1 * var(--mr-panel-handle-inset) - ${HALF_GAP})`;
globalStyle(`${FloatingShell} ${Panel}[data-side='start'] > ${Handle}`, {
  insetInlineEnd: handleOffset,
});
globalStyle(`${FloatingShell} ${SIDE_PANEL} > ${Handle}${Handle}`, {
  insetInlineStart: handleOffset,
});
globalStyle(
  `${FloatingShell} ${Handle}:not(${PageSurface} *):not(:hover):not(:focus-visible):not(:active)::after`,
  { backgroundColor: 'transparent' }
);

// The conversation's minimap keeps off the card's edge, where it would read as a splitter grip.
globalStyle(`${FloatingShell} ${MinimapContainer}`, { insetInlineStart: config.space.S100 });

// The card's gap now separates the list from the page, so rows end S300 before the column's edge:
// the open row's highlight sits as far from the card as from the rail. The list's scrollbar moves
// into the column's last S300, clear of the rows; the splitter stays grabbable across the gap. The
// column's title ends where the rows do, so its menu button lines up with them.
globalStyle(`${FloatingShell} ${PageNavContent}`, { paddingInlineEnd: config.space.S300 });
globalStyle(`${FloatingShell} ${PageNavTrack}${PageNavTrack}${PageNavTrack}`, {
  insetInlineEnd: 0,
});
globalStyle(`${FloatingShell} ${PageNavHeader}`, { paddingInlineEnd: config.space.S300 });
// The Recently Opened panel at the column's foot ends on the same line.
globalStyle(`${FloatingShell} ${RecentlyOpenedPanel}`, { paddingInlineEnd: config.space.S300 });
