import { globalStyle, style } from '@vanilla-extract/css';
import { color, config } from 'folds';
import { Handle, Panel } from '../../mindroom/sidebar/ResizablePanel.css';
import { Header as RoomHeader } from '../../mindroom/threads/RoomOverlay.css';

// Floating cards: wherever the navigation and the content share the screen, the rail and the room
// list sit on the app background and every page, and every side panel beside a room, is a card
// inset by S200 from the window's edges, from the list and from each other. Dialogs render in a
// portal outside the shell, so their pages stay as they are; phones keep the full-bleed layout.

const CARD_GAP = config.space.S200;
const CARD_LINE = `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`;

const card = {
  border: CARD_LINE,
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

// A side panel of a room is a card of the conversation's height, a gap after the conversation.
globalStyle(`${FloatingShell} ${Panel}[data-side='end']`, {
  paddingBlock: CARD_GAP,
  paddingInlineEnd: CARD_GAP,
});
// Expanded, a panel takes the conversation's place, so it keeps the gap on both sides.
globalStyle(`${FloatingShell} ${Panel}[data-side='end']:first-child`, {
  paddingInlineStart: CARD_GAP,
});
globalStyle(`${FloatingShell} ${Panel}[data-side='end'] > :first-child`, card);

// The splitters run through the gaps; their line shows only while they are used.
globalStyle(`${FloatingShell} ${Handle}:not(:hover):not(:focus-visible):not(:active)::after`, {
  backgroundColor: 'transparent',
});

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
