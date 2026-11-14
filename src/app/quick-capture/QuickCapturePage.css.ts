import { createVar, globalStyle, keyframes, style } from '@vanilla-extract/css';
import { toRem } from 'folds';

/**
 * The widget's own colors: the label, fill and separator colors of a Mac panel in the light and
 * the dark appearance, with MindRoom's purple as the accent. The window floats over other apps, so
 * it follows the system's appearance and not the theme picked in the app.
 */
const ink = createVar();
const dim = createVar();
const faint = createVar();
const rule = createVar();
const fill = createVar();
const press = createVar();
const pick = createVar();
const paper = createVar();
const face = createVar();
const bezel = createVar();
const accent = createVar();
const alert = createVar();
const caution = createVar();
/** What sits on the accent: the send arrow, the check, the highlighted room. */
const onAccent = '#FFFFFF';

const lightColors = {
  [paper]: '#F5F5F5',
  [ink]: 'rgba(0, 0, 0, 0.85)',
  [dim]: 'rgba(0, 0, 0, 0.56)',
  [faint]: 'rgba(0, 0, 0, 0.36)',
  [rule]: 'rgba(0, 0, 0, 0.1)',
  [fill]: 'rgba(0, 0, 0, 0.06)',
  [press]: 'rgba(0, 0, 0, 0.12)',
  [pick]: 'rgba(0, 0, 0, 0.09)',
  [face]: '#FFFFFF',
  [bezel]: `0 0 0 ${toRem(1)} rgba(0, 0, 0, 0.07), 0 ${toRem(1)} ${toRem(2)} rgba(0, 0, 0, 0.14)`,
  [accent]: '#694CCD',
  [alert]: '#D70015',
  [caution]: '#C93400',
};

const darkColors = {
  [paper]: '#262626',
  [ink]: 'rgba(255, 255, 255, 0.86)',
  [dim]: 'rgba(255, 255, 255, 0.58)',
  [faint]: 'rgba(255, 255, 255, 0.34)',
  [rule]: 'rgba(255, 255, 255, 0.1)',
  [fill]: 'rgba(255, 255, 255, 0.09)',
  [press]: 'rgba(255, 255, 255, 0.18)',
  [pick]: 'rgba(255, 255, 255, 0.12)',
  [face]: 'rgba(255, 255, 255, 0.12)',
  [bezel]: `0 0 0 ${toRem(1)} rgba(255, 255, 255, 0.06), 0 ${toRem(1)} ${toRem(
    2
  )} rgba(0, 0, 0, 0.3)`,
  [accent]: '#7860E0',
  [alert]: '#FF6961',
  [caution]: '#FFB340',
};

/** The two layouts the widget is built of: a column, and a row centred across. */
const stack = { flexFlow: 'column nowrap', display: 'flex' } as const;
const strip = { alignItems: 'center', display: 'flex', flexFlow: 'row nowrap' } as const;
/** A part that takes the rest of the column and may shrink below its content. */
const grow = { flexGrow: 1, minBlockSize: 0 } as const;
/** One line of text that ends in an ellipsis where it runs out of room. */
const oneLine = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;
const flat = { padding: 0, background: 'transparent', border: 0 } as const;
/** A control drawn as plain text, which the widget's own styles then shape. */
const bare = { color: 'inherit', ...flat, font: 'inherit', cursor: 'inherit' } as const;
/** Text the person may select and copy, in a window whose labels are not selectable. */
const selectable = { cursor: 'text', userSelect: 'text', WebkitUserSelect: 'text' } as const;

const hairline = `${toRem(1)} solid ${rule}`;
/** The keyboard focus, as the Mac draws it: a soft ring of the accent around the control. */
const ring = `0 0 0 ${toRem(3)} color-mix(in srgb, ${accent} 45%, transparent)`;
/** Under the ring and the selected row's fill: an outline only forced colors draw. */
const forcedOutline = `${toRem(2)} solid transparent`;
const focusRing = { outline: forcedOutline, boxShadow: ring } as const;

/**
 * The whole window: no card around it, and only the list scrolls. Its labels behave as a Mac
 * app's do: the system font, an arrow for a pointer, nothing selectable but the text itself.
 */
export const Page = style({
  ...stack,
  ...grow,
  vars: lightColors,
  fontFamily: "-apple-system, BlinkMacSystemFont, 'InterVariable', system-ui, sans-serif",
  fontSize: toRem(13),
  color: ink,
  lineHeight: toRem(17),
  overflow: 'hidden',
  backgroundColor: paper,
  cursor: 'default',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  // The weight the system draws its own text with; the app thins its text.
  WebkitFontSmoothing: 'auto',
  '@media': { '(prefers-color-scheme: dark)': { vars: darkColors } },
});

/**
 * In the Mac's window the system's material is the background, behind a web view that draws none:
 * neither the page nor the document the theme paints (applyThemeToDom, inline) covers it.
 */
globalStyle(
  `${Page}[data-native], html:has(${Page}[data-native]), html:has(${Page}[data-native]) body`,
  {
    backgroundColor: 'transparent !important',
  }
);

/**
 * The window has no title bar: its header is the page's, from the window's top edge. An app
 * scaled to match iPad draws a CSS pixel at 0.77 of the Mac's point; the window says by how much
 * to scale the rem (`--mac-point-scale`), which every size here is in, so the text is the size of
 * other apps' text whatever page zoom the app has.
 */
globalStyle(`html:has(${Page}[data-native])`, {
  fontSize: 'calc(var(--mac-point-scale, 1) * 100%) !important',
});
globalStyle(`html:has(${Page}[data-native]) #root`, { paddingBlockStart: 0 });

export const Muted = style({ color: dim });

export const Failure = style({ color: alert });

/** "MindRoom is not open" and "Sign in to MindRoom", in the middle of the window. */
export const Notice = style({
  ...stack,
  ...grow,
  alignItems: 'center',
  rowGap: toRem(12),
  justifyContent: 'center',
  paddingBlock: toRem(24),
  textAlign: 'center',
  paddingInline: toRem(16),
  color: dim,
});

export const NoticeText = style({ marginBlock: 0 });

/**
 * The window's title bar, with the room as its title. The window is dragged by it on the Mac:
 * nothing in it but the room's button may take the mouse down for itself.
 */
export const Header = style({
  ...strip,
  blockSize: toRem(34),
  justifyContent: 'center',
  paddingInline: toRem(12),
  flexShrink: 0,
});

/** The room, as a title that opens a menu: its sigil, its name and a chevron. */
export const RoomButton = style({
  ...bare,
  ...strip,
  columnGap: toRem(4),
  minInlineSize: 0,
  paddingBlock: toRem(2),
  borderRadius: toRem(6),
  paddingInline: toRem(7),
  fontWeight: 600,
  lineHeight: toRem(18),
  selectors: {
    '&:hover': { backgroundColor: fill },
    '&:active, &[aria-expanded="true"]': { backgroundColor: press },
  },
  ':focus-visible': focusRing,
});

export const RoomName = style({ ...oneLine, minInlineSize: 0 });

export const Chevron = style({ flexShrink: 0, color: dim });

/** The entry: its images, the field with its buttons, and what became of the send. */
export const EntryBlock = style({ ...stack, flexShrink: 0, borderBlockEnd: hairline });

export const Entry = style({
  ...stack,
  rowGap: toRem(8),
  paddingBlockStart: toRem(2),
  paddingInline: toRem(14),
  paddingBlockEnd: toRem(11),
});

export const EntryRow = style({ ...strip, alignItems: 'flex-start', columnGap: toRem(8) });

export const EntryField = style({
  ...bare,
  ...selectable,
  flexGrow: 1,
  minInlineSize: 0,
  fontSize: toRem(15),
  // Where the browser sizes a field to its text, one line to start with, growing to six before
  // it scrolls in itself; elsewhere the field's two rows.
  fieldSizing: 'content',
  lineHeight: toRem(22),
  minBlockSize: toRem(22),
  maxBlockSize: toRem(134),
  resize: 'none',
  outline: 'none',
  '::placeholder': { color: faint },
});

export const EntryTools = style({ ...strip, flexShrink: 0, columnGap: toRem(4) });

/** A screenshot button beside the field, and an image's remove button: a quiet glyph. */
export const ToolButton = style({
  ...bare,
  display: 'grid',
  placeItems: 'center',
  inlineSize: toRem(22),
  borderRadius: toRem(6),
  blockSize: toRem(22),
  color: dim,
  selectors: {
    '&:hover:not(:disabled)': { backgroundColor: fill },
    '&:active:not(:disabled)': { backgroundColor: press },
    '&:disabled': { opacity: 0.45 },
  },
  ':focus-visible': focusRing,
});

/** Send: an arrow in a disc, gray until there is something to send, then the accent. */
export const SendButton = style({
  ...bare,
  display: 'grid',
  flexShrink: 0,
  placeItems: 'center',
  inlineSize: toRem(22),
  borderRadius: '50%',
  blockSize: toRem(22),
  color: dim,
  backgroundColor: fill,
  selectors: {
    '&[data-ready="true"]': { color: onAccent, backgroundColor: accent },
    '&[data-ready="true"]:active': { filter: 'brightness(0.88)' },
    '&:disabled': { opacity: 0.45 },
  },
  ':focus-visible': focusRing,
});

/** Sending, a failed send or a failed screenshot, under the field. */
export const Status = style({
  ...strip,
  gap: toRem(8),
  flexWrap: 'wrap',
  paddingInline: toRem(14),
  fontSize: toRem(12),
  paddingBlockEnd: toRem(9),
});

export const Attachments = style({ ...strip, gap: toRem(6), flexWrap: 'wrap' });

/** An image of the entry: its name on a fill, with a remove button. */
export const Attachment = style({
  ...strip,
  columnGap: toRem(4),
  maxInlineSize: '100%',
  paddingInlineStart: toRem(7),
  fontSize: toRem(12),
  borderRadius: toRem(6),
  paddingInlineEnd: toRem(1),
  backgroundColor: fill,
});

export const AttachmentName = style({ ...oneLine, minInlineSize: 0 });

export const AttachmentRemove = style([
  ToolButton,
  { inlineSize: toRem(20), blockSize: toRem(20), borderRadius: toRem(5) },
]);

/** The keys of the part of the widget that has the focus, at the window's foot. */
export const Footer = style({
  ...strip,
  color: dim,
  flexWrap: 'wrap',
  gap: `${toRem(4)} ${toRem(12)}`,
  flexShrink: 0,
  paddingBlock: toRem(7),
  paddingInline: toRem(14),
  fontSize: toRem(11),
  borderBlockStart: hairline,
  lineHeight: toRem(16),
});

export const Hint = style({ ...strip, columnGap: toRem(4) });

/** A key, written as the Mac's menus write it, on a fill. */
export const Key = style({
  display: 'inline-block',
  minInlineSize: toRem(16),
  boxSizing: 'border-box',
  paddingInline: toRem(4),
  borderRadius: toRem(4),
  font: 'inherit',
  backgroundColor: fill,
  textAlign: 'center',
  unicodeBidi: 'isolate',
  whiteSpace: 'nowrap',
});

/** The room's threads, or the rooms to pick from; the one part of the window that scrolls. */
export const List = style({ ...stack, ...grow, overflowY: 'auto', paddingBlock: toRem(5) });

export const Empty = style({
  marginBlock: 0,
  paddingBlock: toRem(24),
  color: dim,
  paddingInline: toRem(14),
  textAlign: 'center',
});

/**
 * A thread: its leading mark beside its lines, the peek under them. The selected row is the one
 * with the focus in it, on a rounded fill set in from the window's edges.
 */
export const Item = style({
  display: 'grid',
  gridTemplateColumns: `${toRem(16)} minmax(0, 1fr)`,
  columnGap: toRem(9),
  marginInline: toRem(6),
  paddingBlock: toRem(6),
  borderRadius: toRem(8),
  paddingInline: toRem(8),
  selectors: { '&:focus-within': { backgroundColor: pick, outline: forcedOutline } },
});

/** The leading mark: a ring for an open thread, a filled check for a resolved one. */
export const Mark = style({
  ...bare,
  display: 'grid',
  placeItems: 'center',
  // The check is 1em.
  fontSize: toRem(10),
  inlineSize: toRem(16),
  marginBlockStart: toRem(0.5),
  blockSize: toRem(16),
  borderRadius: '50%',
  border: `${toRem(1.5)} solid ${faint}`,
  selectors: {
    '&:hover:not(:disabled)': { borderColor: dim },
    '&:active:not(:disabled)': { backgroundColor: press },
    '&:disabled': { opacity: 0.5 },
  },
  ':focus-visible': focusRing,
});

/** A pinned thread's mark: the pin, where the circle that resolves would be. */
export const MarkPinned = style({ color: dim, borderColor: 'transparent' });

export const MarkResolved = style({
  color: onAccent,
  borderColor: accent,
  backgroundColor: accent,
  selectors: {
    '&&:hover:not(:disabled)': { borderColor: accent },
    '&&:active:not(:disabled)': { backgroundColor: accent, filter: 'brightness(0.88)' },
  },
});

/** The row's two lines: the button that selects the thread and peeks at it. */
export const Row = style({ ...stack, position: 'relative', minInlineSize: 0, outline: 'none' });

/** A thread resolved in the last day, dimmed under the open ones. */
export const Resolved = style({ opacity: 0.6 });

/** "Resolved", for a screen reader: the eye has the check and the dimming. */
export const Unseen = style({
  position: 'absolute',
  inlineSize: toRem(1),
  clipPath: 'inset(50%)',
  blockSize: toRem(1),
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});

/** The first line: the title, and at its end what the thread is doing and when it last moved. */
export const RowHead = style({ ...strip, columnGap: toRem(8) });

export const RowTitle = style({ ...oneLine, flexGrow: 1, minInlineSize: 0, fontWeight: 500 });

export const RowLine = style({
  ...oneLine,
  fontSize: toRem(12),
  color: dim,
  lineHeight: toRem(16),
});

export const RowMeta = style({
  ...strip,
  flexShrink: 0,
  columnGap: toRem(5),
  blockSize: toRem(17),
  color: dim,
  fontSize: toRem(11),
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
});

/** An answer nobody read yet: the dot Mail puts on an unread message. */
export const UnreadDot = style({
  inlineSize: toRem(8),
  borderRadius: '50%',
  blockSize: toRem(8),
  backgroundColor: accent,
});

/** An approval or a question that waits for the person. */
export const NeedsYou = style({ color: caution, fontWeight: 600 });

const turn = keyframes({ to: { transform: 'rotate(1turn)' } });

/** While an agent streams: the system's spinner, eight spokes that step around. */
export const Spinner = style({
  inlineSize: toRem(12),
  fill: 'currentColor',
  blockSize: toRem(12),
  animation: `${turn} 0.8s steps(8) infinite`,
  '@media': { '(prefers-reduced-motion: reduce)': { animation: 'none' } },
});

export const RowError = style({
  gridColumn: 2,
  marginBlock: `${toRem(4)} 0`,
  fontSize: toRem(12),
  color: alert,
});

/** Under the row's title: the newest reply in full, its buttons and the reply field. */
export const Peek = style({
  ...stack,
  gridColumn: 2,
  rowGap: toRem(8),
  marginBlockStart: toRem(3),
  paddingBlockEnd: toRem(2),
});

export const Answer = style({
  ...selectable,
  marginBlock: 0,
  whiteSpace: 'pre-wrap',
  lineHeight: toRem(18),
  overflowWrap: 'anywhere',
});

/** Who answered, on a line of its own over the answer. */
export const Sender = style({
  display: 'block',
  fontSize: toRem(11),
  color: dim,
  fontWeight: 600,
  lineHeight: toRem(16),
});

export const PeekActions = style({ ...strip, gap: toRem(6), flexWrap: 'wrap' });

/** A small push button, as AppKit draws one: the peek's, the notice's and the status line's. */
export const SmallButton = style({
  ...bare,
  paddingBlock: toRem(3),
  borderRadius: toRem(6),
  paddingInline: toRem(10),
  fontSize: toRem(12),
  backgroundColor: face,
  fontWeight: 500,
  lineHeight: toRem(16),
  boxShadow: bezel,
  selectors: {
    '&:active:not(:disabled)': { backgroundColor: press },
    '&:disabled': { opacity: 0.45 },
    '&:focus-visible': { outline: forcedOutline, boxShadow: `${bezel}, ${ring}` },
  },
});

const fieldEdge = `inset 0 0 0 ${toRem(1)} ${rule}`;

export const ReplyField = style({
  ...bare,
  ...selectable,
  minInlineSize: 0,
  blockSize: toRem(26),
  paddingInline: toRem(8),
  borderRadius: toRem(6),
  backgroundColor: face,
  boxShadow: fieldEdge,
  '::placeholder': { color: faint },
  ':focus-visible': { outline: forcedOutline, boxShadow: `${fieldEdge}, ${ring}` },
});

export const Search = style({
  ...strip,
  columnGap: toRem(7),
  paddingBlock: toRem(9),
  color: dim,
  paddingInline: toRem(14),
  borderBlockEnd: hairline,
});

/** A pick the host refused, under the search row. */
export const PickerError = style({
  marginBlock: 0,
  paddingBlock: toRem(6),
  color: alert,
  paddingInline: toRem(14),
  fontSize: toRem(12),
});

export const SearchField = style({
  ...bare,
  ...selectable,
  flexGrow: 1,
  minInlineSize: 0,
  color: ink,
  outline: 'none',
  '::placeholder': { color: faint },
});

/**
 * A room to pick. The highlighted one is drawn as a menu draws its item: on the accent, inside
 * an outline that only forced colors paint.
 */
export const Option = style({
  ...strip,
  columnGap: toRem(7),
  marginInline: toRem(6),
  paddingBlock: toRem(5),
  borderRadius: toRem(6),
  paddingInline: toRem(8),
  selectors: {
    '&[aria-selected="true"]': {
      color: onAccent,
      backgroundColor: accent,
      outline: forcedOutline,
    },
  },
});

/** What a part of a highlighted room takes: the color of the room's name. */
const onHighlight = { [`${Option}[aria-selected="true"] &`]: { color: 'inherit' } };

/** The `#` of a room and the `@` of a direct chat, before its name. */
export const Sigil = style({ color: dim, fontWeight: 500, selectors: onHighlight });

export const OptionName = style({ ...oneLine, flexGrow: 1, minInlineSize: 0 });

/** The check of the room entries go to now. */
export const OptionCurrent = style({ flexShrink: 0, color: accent, selectors: onHighlight });
