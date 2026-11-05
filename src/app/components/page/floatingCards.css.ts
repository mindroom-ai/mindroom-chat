import { globalStyle, style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { Handle, Panel } from '../../mindroom/sidebar/ResizablePanel.css';
import { Header as RoomHeader } from '../../mindroom/threads/RoomOverlay.css';
import { MinimapContainer } from '../../mindroom/threads/TimelineMinimap.css';
import { RecentlyOpenedPanel } from '../../mindroom/recent-threads/threadNav.css';
import { PageNavContent, PageNavHeader, PageNavTrack } from './style.css';

// Floating cards: wherever the navigation and the content share the screen, the rail and the room
// list sit on the app background and every page, and every side panel beside a room, is a card
// inset by S200 from the window's edges, from the list and from each other. Dialogs render in a
// portal outside the shell, so their pages stay as they are; phones, also held sideways, keep the
// full-bleed layout.

const CARD_GAP = config.space.S200;

const card = {
  // The line is a shadow just outside the card, so it takes no width from what the card holds.
  boxShadow: `0 0 0 ${config.borderWidth.B300} ${color.Background.ContainerLine}`,
  borderRadius: config.radii.R500,
  backgroundColor: color.Surface.Container,
  // Clips content to the rounded corners without making the card a scroll container, so sticky
  // headers inside keep sticking to their own scrolling areas.
  overflow: 'clip',
} as const;

/** The signed-in layout of the rail and the page, while the content shows as cards. */
export const FloatingShell = style({});

/** Marks every page of the client; a page inside another page stays flat. */
export const PageSurface = style({});

/** The divider between the navigation column and the page, which the gap replaces. */
export const PageDivider = style({});

globalStyle(`${FloatingShell} ${PageSurface}:not(${PageSurface} *)`, {
  ...card,
  margin: CARD_GAP,
});

globalStyle(`${FloatingShell} ${PageDivider}`, { display: 'none' });

// A side panel of a room is a card of the conversation's height, a gap after the conversation. The
// room keeps the gap at its end around the panel, so the panel's card is as wide as the panel.
globalStyle(`${FloatingShell} :has(> ${Panel}[data-side='end'])`, {
  paddingInlineEnd: CARD_GAP,
});
globalStyle(`${FloatingShell} ${Panel}[data-side='end']`, { paddingBlock: CARD_GAP });
// Expanded, a panel takes the conversation's place, so it keeps the gap on both sides.
globalStyle(`${FloatingShell} ${Panel}[data-side='end']:first-child`, {
  paddingInlineStart: CARD_GAP,
});
globalStyle(`${FloatingShell} ${Panel}[data-side='end'] > :first-child`, card);

// The splitters run through the gaps: each handle moves half a gap off its panel's edge, so it and
// its line sit in the middle of the gap, and the line shows only while the splitter is used.
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
globalStyle(`${FloatingShell} ${Panel}[data-side='end'] > ${Handle}${Handle}`, {
  insetInlineStart: handleOffset,
});
globalStyle(`${FloatingShell} ${Handle}:not(:hover):not(:focus-visible):not(:active)::after`, {
  backgroundColor: 'transparent',
});

// The conversation's minimap keeps off the card's edge, where it would read as a splitter grip.
globalStyle(`${FloatingShell} ${MinimapContainer}`, { insetInlineStart: config.space.S100 });

// The room header sits inside the card with a hairline under it, which leaves its height alone.
globalStyle(`${FloatingShell} ${RoomHeader}::after`, {
  content: '""',
  position: 'absolute',
  insetInline: 0,
  insetBlockEnd: 0,
  blockSize: config.borderWidth.B300,
  backgroundColor: color.Surface.ContainerLine,
  pointerEvents: 'none',
});

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
