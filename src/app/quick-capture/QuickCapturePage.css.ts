import { keyframes, style, styleVariants } from '@vanilla-extract/css';
import { color, toRem } from 'folds';

/** The two layouts the widget is built of: a column, and a row centred across. */
const stack = { display: 'flex', flexFlow: 'column nowrap' } as const;
const strip = { display: 'flex', flexFlow: 'row nowrap', alignItems: 'center' } as const;
/** A part that takes the rest of the column and may shrink below its content. */
const grow = { flexGrow: 1, minBlockSize: 0 } as const;
/** One line of text that ends in an ellipsis where it runs out of room. */
const oneLine = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
const flat = { border: 0, padding: 0, background: 'transparent' } as const;
/** A control drawn as plain text, which the widget's own styles then shape. */
const bare = { ...flat, color: 'inherit', font: 'inherit' } as const;

const line = color.Surface.ContainerLine;
const hairline = `${toRem(1)} solid ${line}`;
/** Secondary text: the page's text color, faded, so it reads in both themes. */
const muted = `color-mix(in srgb, ${color.Surface.OnContainer} 62%, transparent)`;
/** The selected row's and the highlighted room's background: a trace of the primary color. */
const tint = `color-mix(in srgb, ${color.Primary.Main} 11%, transparent)`;
const focusRing = {
  outline: `${toRem(2)} solid ${color.Primary.Main}`,
  outlineOffset: toRem(1),
} as const;

/** The whole window: no card around it, and only the list scrolls. */
export const Page = style({
  ...stack,
  ...grow,
  fontSize: toRem(13),
  color: color.Surface.OnContainer,
  lineHeight: 1.4,
  overflow: 'hidden',
  backgroundColor: color.Surface.Container,
});

export const Muted = style({ color: muted });

export const Failure = style({ color: color.Critical.Main });

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
  fontSize: toRem(12.5),
  color: muted,
});

export const NoticeText = style({ marginBlock: 0 });

/** The window's drag area on the Mac: nothing in it may take the mouse down for itself. */
export const Header = style({
  ...strip,
  paddingBlock: toRem(8),
  paddingInline: toRem(10),
  borderBlockEnd: hairline,
});

/** The room, as a chip: its sigil, its name and a chevron. */
export const RoomButton = style({
  ...bare,
  ...strip,
  columnGap: toRem(5),
  minInlineSize: 0,
  paddingBlock: toRem(3),
  paddingInline: toRem(8),
  borderRadius: toRem(7),
  backgroundColor: color.SurfaceVariant.Container,
  fontSize: toRem(12.5),
  cursor: 'pointer',
  fontWeight: 600,
  lineHeight: toRem(18),
  ':hover': { backgroundColor: color.SurfaceVariant.ContainerHover },
  ':focus-visible': focusRing,
});

export const RoomName = style({ ...oneLine, minInlineSize: 0 });

/** The `#` of a room and the `@` of a direct chat, before its name. */
export const Sigil = style({ color: color.Primary.Main, fontWeight: 700 });

export const Chevron = style({ flexShrink: 0, color: muted });

/** The entry: its images, the field with its buttons, what became of the send, its keys. */
export const EntryBlock = style({ ...stack, flexShrink: 0, borderBlockEnd: hairline });

export const Entry = style({
  ...stack,
  rowGap: toRem(8),
  paddingBlockStart: toRem(10),
  paddingInline: toRem(12),
  paddingBlockEnd: toRem(4),
});

export const EntryRow = style({ ...strip, alignItems: 'flex-start', columnGap: toRem(6) });

export const EntryField = style({
  ...bare,
  flexGrow: 1,
  minInlineSize: 0,
  fontSize: toRem(15),
  // Where the browser sizes a field to its text, one line to start with, growing to six before
  // it scrolls in itself; elsewhere the field's two rows.
  fieldSizing: 'content',
  lineHeight: toRem(22),
  minBlockSize: toRem(24),
  maxBlockSize: toRem(134),
  resize: 'none',
  outline: 'none',
  '::placeholder': { color: muted },
});

export const EntryTools = style({ ...strip, flexShrink: 0, columnGap: toRem(2) });

/** A 24-point icon button beside the field: muted, primary once there is something to send. */
export const ToolButton = style({
  ...bare,
  display: 'grid',
  placeItems: 'center',
  inlineSize: toRem(24),
  borderRadius: toRem(6),
  blockSize: toRem(24),
  cursor: 'pointer',
  color: muted,
  selectors: {
    '&:hover:not(:disabled)': { backgroundColor: color.SurfaceVariant.Container },
    '&[data-ready="true"]': { color: color.Primary.Main },
    '&:disabled': { cursor: 'default', opacity: 0.45 },
  },
  ':focus-visible': focusRing,
});

/** Sending, a failed send or a failed screenshot, under the field. */
export const Status = style({
  ...strip,
  flexWrap: 'wrap',
  gap: toRem(6),
  paddingInline: toRem(12),
  fontSize: toRem(12),
  paddingBlockEnd: toRem(6),
});

export const Attachments = style({ ...strip, flexWrap: 'wrap', gap: toRem(6) });

/** An image of the entry: the same shape as the peek's buttons, with a remove button. */
export const Attachment = style({
  ...strip,
  columnGap: toRem(4),
  maxInlineSize: '100%',
  paddingInlineStart: toRem(7),
  fontSize: toRem(11.5),
  borderRadius: toRem(7),
  paddingInlineEnd: toRem(2),
  border: hairline,
  backgroundColor: color.SurfaceVariant.Container,
});

export const AttachmentName = style({ ...oneLine, minInlineSize: 0 });

export const AttachmentRemove = style([
  ToolButton,
  { inlineSize: toRem(20), blockSize: toRem(20), borderRadius: toRem(5) },
]);

/** A line of keys and what they do, under the field and at the window's foot. */
const hintLine = {
  ...strip,
  flexWrap: 'wrap',
  // Tight enough that a line of Ctrl and Enter hints fits the 360-point window.
  gap: `${toRem(4)} ${toRem(7)}`,
  fontSize: toRem(11),
  color: muted,
} as const;

export const EntryHints = style({
  ...hintLine,
  paddingInline: toRem(12),
  paddingBlockEnd: toRem(8),
});

/** The list's keys, or the picker's: quiet while the focus is elsewhere. */
export const Footer = style({
  ...hintLine,
  flexShrink: 0,
  paddingBlock: toRem(6),
  opacity: 0.55,
  paddingInline: toRem(12),
  borderBlockStart: hairline,
  transition: 'opacity 120ms',
  selectors: { '&[data-active="true"]': { opacity: 1 } },
});

export const Hint = style({ ...strip, columnGap: toRem(3) });

/** A key cap, the same in the hint lines, on the peek's buttons and in the reply field. */
export const Key = style({
  fontSize: toRem(11),
  fontFamily: 'inherit',
  lineHeight: 1,
  paddingBlock: toRem(2),
  whiteSpace: 'nowrap',
  paddingInline: toRem(5),
  borderRadius: toRem(5),
  unicodeBidi: 'isolate',
  border: hairline,
  fontWeight: 400,
  color: muted,
  backgroundColor: color.SurfaceVariant.Container,
});

/** The room's threads; the one part of the window that scrolls. */
export const List = style({ ...stack, ...grow, overflowY: 'auto' });

export const Empty = style({
  marginBlock: 0,
  paddingBlock: toRem(24),
  color: muted,
  paddingInline: toRem(12),
  fontSize: toRem(12.5),
  textAlign: 'center',
});

/**
 * A thread: its leading mark beside its lines, the peek under them. The selected row is the one
 * with the focus in it, tinted and marked at its start edge.
 */
export const Item = style({
  display: 'grid',
  gridTemplateColumns: `${toRem(16)} minmax(0, 1fr)`,
  position: 'relative',
  columnGap: toRem(10),
  paddingBlock: toRem(8),
  paddingInline: toRem(12),
  selectors: {
    '& + &': { borderBlockStart: hairline },
    '&:hover': { backgroundColor: color.SurfaceVariant.Container },
    '&:focus-within': { backgroundColor: tint },
    '&:focus-within::before': {
      position: 'absolute',
      inlineSize: toRem(3),
      insetInlineStart: 0,
      backgroundColor: color.Primary.Main,
      insetBlock: 0,
      content: '""',
    },
  },
});

/** The leading mark: a ring for an open thread, a filled check for a resolved one. */
export const Mark = style({
  ...bare,
  display: 'grid',
  placeItems: 'center',
  // The check is 1em.
  fontSize: toRem(10),
  inlineSize: toRem(16),
  marginBlockStart: toRem(1),
  blockSize: toRem(16),
  borderRadius: '50%',
  cursor: 'pointer',
  border: `${toRem(1.5)} solid ${muted}`,
  selectors: {
    '&:hover:not(:disabled)': { borderColor: color.Primary.Main },
    '&:disabled': { cursor: 'default', opacity: 0.5 },
  },
  ':focus-visible': focusRing,
});

export const MarkResolved = style({
  color: color.Success.OnMain,
  borderColor: color.Success.Main,
  backgroundColor: color.Success.Main,
  selectors: { '&&:hover:not(:disabled)': { borderColor: color.Success.Main } },
});

/** The row's lines and its chip: the button that selects the thread and peeks at it. */
export const Row = style({
  ...strip,
  alignItems: 'flex-start',
  minInlineSize: 0,
  columnGap: toRem(8),
  cursor: 'pointer',
  outline: 'none',
});

/** A thread resolved in the last day, dimmed under the open ones. */
export const Resolved = style({ opacity: 0.6 });

export const RowText = style({ ...stack, flexGrow: 1, minInlineSize: 0, rowGap: toRem(1) });

export const RowTitle = style({
  ...oneLine,
  fontSize: toRem(13),
  fontWeight: 600,
  lineHeight: toRem(18),
  selectors: { [`${Resolved} &`]: { textDecoration: 'line-through' } },
});

export const RowLine = style({
  ...oneLine,
  fontSize: toRem(12),
  color: muted,
  lineHeight: toRem(17),
});

export const RowChip = style({
  ...strip,
  flexShrink: 0,
  columnGap: toRem(5),
  marginBlockStart: toRem(1),
  paddingBlock: toRem(1),
  borderRadius: toRem(999),
  paddingInline: toRem(7),
  fontSize: toRem(10.5),
  whiteSpace: 'nowrap',
  fontWeight: 700,
  lineHeight: toRem(14),
});

export const Chip = styleVariants({
  working: { color: muted, backgroundColor: color.SurfaceVariant.Container },
  'needs-you': { color: color.Warning.OnContainer, backgroundColor: color.Warning.Container },
  new: { color: color.Primary.OnMain, backgroundColor: color.Primary.Main },
  resolved: { color: muted },
});

const pulse = keyframes({ '50%': { opacity: 0.25 } });

/** Before `working`: a dot that pulses while an agent streams. */
export const WorkingDot = style({
  inlineSize: toRem(6),
  blockSize: toRem(6),
  borderRadius: '50%',
  backgroundColor: color.Primary.Main,
  animation: `${pulse} 1.4s ease-in-out infinite`,
  '@media': { '(prefers-reduced-motion: reduce)': { animation: 'none' } },
});

export const RowError = style({
  gridColumn: 2,
  marginBlock: `${toRem(4)} 0`,
  fontSize: toRem(12),
  color: color.Critical.Main,
});

/** The newest reply under the row's lines, its buttons and the reply field. */
export const Peek = style({
  ...stack,
  gridColumn: 2,
  rowGap: toRem(8),
  marginBlockStart: toRem(8),
});

export const Answer = style({
  marginBlock: 0,
  whiteSpace: 'pre-wrap',
  paddingInlineStart: toRem(9),
  lineHeight: 1.45,
  borderInlineStart: `${toRem(2)} solid ${color.Primary.Main}`,
  overflowWrap: 'anywhere',
  fontSize: toRem(12.5),
});

export const Sender = style({ fontWeight: 600 });

export const PeekActions = style({ ...strip, flexWrap: 'wrap', gap: toRem(6) });

/** A small button with its key cap: the peek's, and the notice's. */
export const SmallButton = style({
  ...bare,
  ...strip,
  columnGap: toRem(6),
  paddingBlock: toRem(4),
  fontSize: toRem(11.5),
  paddingInline: toRem(8),
  fontWeight: 600,
  borderRadius: toRem(7),
  lineHeight: toRem(16),
  border: hairline,
  cursor: 'pointer',
  backgroundColor: color.SurfaceVariant.Container,
  selectors: {
    '&:hover:not(:disabled)': { backgroundColor: color.SurfaceVariant.ContainerHover },
    '&:disabled': { cursor: 'default', opacity: 0.5 },
  },
  ':focus-visible': focusRing,
});

/** The reply field and its key cap, in one grid cell: the cap sits at the field's end. */
export const ReplyBox = style({ display: 'grid', alignItems: 'center' });

export const ReplyField = style({
  ...bare,
  gridArea: '1 / 1',
  minInlineSize: 0,
  blockSize: toRem(28),
  paddingInlineStart: toRem(9),
  borderRadius: toRem(8),
  paddingInlineEnd: toRem(28),
  fontSize: toRem(12.5),
  border: hairline,
  backgroundColor: color.Surface.Container,
  '::placeholder': { color: muted },
  ':focus-visible': { outline: 'none', borderColor: color.Primary.Main },
});

/** The reply field's `r`, at its end while it is empty. */
export const ReplyKey = style([
  Key,
  {
    gridArea: '1 / 1',
    marginInlineEnd: toRem(7),
    justifySelf: 'end',
    pointerEvents: 'none',
  },
]);

export const Search = style({
  ...strip,
  columnGap: toRem(9),
  paddingBlock: toRem(10),
  color: muted,
  paddingInline: toRem(12),
  borderBlockEnd: hairline,
});

/** A pick the host refused, under the search row. */
export const PickerError = style({
  marginBlock: 0,
  paddingBlock: toRem(6),
  color: color.Critical.Main,
  paddingInline: toRem(12),
  fontSize: toRem(12),
});

export const SearchField = style({
  ...bare,
  flexGrow: 1,
  minInlineSize: 0,
  fontSize: toRem(13.5),
  color: color.Surface.OnContainer,
  outline: 'none',
  '::placeholder': { color: muted },
});

export const Option = style({
  ...strip,
  columnGap: toRem(10),
  paddingBlock: toRem(7),
  cursor: 'pointer',
  paddingInline: toRem(12),
  fontSize: toRem(13),
  fontWeight: 600,
  selectors: {
    '&[aria-selected="true"]': { backgroundColor: tint },
    '&:hover:not([aria-selected="true"])': { backgroundColor: color.SurfaceVariant.Container },
  },
});

export const OptionName = style({ ...oneLine, flexGrow: 1, minInlineSize: 0 });

export const OptionCurrent = style({ flexShrink: 0, color: color.Primary.Main });
