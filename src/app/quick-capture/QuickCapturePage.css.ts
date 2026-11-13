import { style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const { space, radii, borderWidth } = config;
/** The two layouts the widget is built of: a column, and a row centred across. */
const stack = { display: 'flex', flexFlow: 'column nowrap' } as const;
const strip = { display: 'flex', flexFlow: 'row nowrap', alignItems: 'center' } as const;
/** A part that takes the rest of the column and may shrink below its content. */
const grow = { flexGrow: 1, minBlockSize: 0 } as const;
const hairline = `${borderWidth.B300} solid ${color.Surface.ContainerLine}`;
/** A control drawn as plain text, which the widget's own styles then shape. */
const bare = { border: 0, color: 'inherit', font: 'inherit', background: 'transparent' } as const;
const focusRing = {
  outline: `${borderWidth.B400} solid ${color.Primary.Main}`,
  outlineOffset: `calc(-1 * ${borderWidth.B400})`,
} as const;

/** The whole window: no card around it, and only the list scrolls. */
export const Page = style({
  ...stack,
  ...grow,
  color: color.Surface.OnContainer,
  overflow: 'hidden',
  backgroundColor: color.Surface.Container,
});

/** "MindRoom is not open" and "Sign in to MindRoom", in the middle of the window. */
export const Notice = style({
  ...stack,
  ...grow,
  alignItems: 'center',
  rowGap: space.S400,
  justifyContent: 'center',
  padding: space.S600,
  textAlign: 'center',
});

/** The window's drag area on the Mac: nothing in it may take the mouse down for itself. */
export const Header = style({
  ...strip,
  columnGap: space.S200,
  paddingBlock: space.S200,
  paddingInline: space.S300,
  borderBlockEnd: hairline,
});

export const RoomButton = style({
  ...bare,
  ...strip,
  columnGap: space.S100,
  minInlineSize: 0,
  paddingBlock: space.S100,
  paddingInline: space.S200,
  borderRadius: radii.R300,
  backgroundColor: color.SurfaceVariant.Container,
  fontWeight: config.fontWeight.W600,
  cursor: 'pointer',
  selectors: { '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover } },
  ':focus-visible': focusRing,
});

/** The `#` of a room and the `@` of a direct chat, before its name. */
export const Sigil = style({ color: color.Primary.Main, fontWeight: config.fontWeight.W700 });

export const Attachments = style({
  ...strip,
  flexWrap: 'wrap',
  gap: space.S100,
  paddingBlockStart: space.S200,
  paddingInline: space.S300,
});

export const Attachment = style({
  ...strip,
  columnGap: space.S100,
  maxInlineSize: '100%',
  paddingInlineStart: space.S200,
  borderRadius: radii.R300,
  backgroundColor: color.SurfaceVariant.Container,
});

export const Entry = style({
  ...strip,
  alignItems: 'flex-start',
  columnGap: space.S100,
  paddingBlock: space.S200,
  paddingInline: space.S300,
});

export const EntryField = style({
  ...bare,
  flexGrow: 1,
  minInlineSize: 0,
  // Where the browser sizes a field to its text, one line to start with, growing to six before
  // it scrolls in itself; elsewhere the field's two rows.
  fieldSizing: 'content',
  minBlockSize: toRem(28),
  maxBlockSize: toRem(128),
  resize: 'none',
  paddingBlock: space.S100,
  fontSize: toRem(15),
  lineHeight: toRem(20),
  outline: 'none',
  '::placeholder': { color: color.SurfaceVariant.OnContainer, opacity: 0.7 },
});

export const EntryTools = style({ ...strip, columnGap: space.S100, flexShrink: 0 });

/** Sending, a failed send or a failed screenshot, under the input. */
export const Status = style({
  ...strip,
  flexWrap: 'wrap',
  gap: space.S200,
  paddingBlockEnd: space.S200,
  paddingInline: space.S300,
});

export const Failure = style({ color: color.Critical.Main });

/** The room's threads; the one part of the window that scrolls. */
export const List = style({
  ...stack,
  ...grow,
  overflowY: 'auto',
  borderBlockStart: hairline,
});

export const Empty = style({
  paddingBlock: space.S500,
  paddingInline: space.S300,
  color: color.SurfaceVariant.OnContainer,
  textAlign: 'center',
});

export const Item = style({
  ...stack,
  selectors: { '& + &': { borderBlockStart: hairline } },
});

export const Row = style({
  ...strip,
  alignItems: 'flex-start',
  columnGap: space.S200,
  position: 'relative',
  paddingBlock: space.S200,
  cursor: 'pointer',
  paddingInline: space.S300,
  outline: 'none',
  selectors: {
    // The selected row: the one with the focus, marked at its start edge.
    '&:focus': { backgroundColor: color.SurfaceVariant.Container },
    '&:focus::before': {
      position: 'absolute',
      inlineSize: toRem(3),
      insetInlineStart: 0,
      backgroundColor: color.Primary.Main,
      insetBlock: 0,
      content: '""',
    },
    '&:hover:not(:focus)': { backgroundColor: color.Surface.ContainerHover },
  },
});

/** A thread resolved in the last day, dimmed under the open ones. */
export const Resolved = style({ opacity: 0.6 });

export const RowText = style({ ...stack, flexGrow: 1, minInlineSize: 0, rowGap: toRem(2) });

export const RowTitle = style({ fontWeight: config.fontWeight.W600 });

export const Muted = style({ color: color.SurfaceVariant.OnContainer });

export const RowChip = style({
  flexShrink: 0,
  paddingBlock: toRem(2),
  whiteSpace: 'nowrap',
  paddingInline: space.S200,
  fontSize: toRem(11),
  borderRadius: toRem(999),
  fontWeight: config.fontWeight.W700,
});

export const Chip = styleVariants({
  working: { color: color.Secondary.Main, backgroundColor: color.Secondary.Container },
  'needs-you': { color: color.Warning.OnContainer, backgroundColor: color.Warning.Container },
  new: { color: color.Primary.OnMain, backgroundColor: color.Primary.Main },
});

export const RowError = style({
  paddingBlockEnd: space.S200,
  paddingInline: space.S300,
  color: color.Critical.Main,
});

/** The newest reply under its row, its buttons and the reply field. */
export const Peek = style({
  ...stack,
  rowGap: space.S200,
  paddingBlockEnd: space.S300,
  paddingInlineStart: `calc(${space.S300} + ${toRem(3)})`,
  paddingInlineEnd: space.S300,
  backgroundColor: color.SurfaceVariant.Container,
});

export const Answer = style({
  paddingInlineStart: space.S200,
  borderInlineStart: `${toRem(2)} solid ${color.Primary.Main}`,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});

export const PeekActions = style({ ...strip, flexWrap: 'wrap', gap: space.S100 });

export const TextField = style({
  ...bare,
  inlineSize: '100%',
  paddingBlock: space.S100,
  paddingInline: space.S200,
  borderRadius: radii.R300,
  border: hairline,
  backgroundColor: color.Surface.Container,
  ':focus-visible': focusRing,
});

export const Search = style({
  ...strip,
  columnGap: space.S200,
  paddingBlock: space.S200,
  paddingInline: space.S300,
  borderBlockStart: hairline,
});

export const SearchField = style({ ...bare, flexGrow: 1, minInlineSize: 0, outline: 'none' });

export const Option = style({
  ...strip,
  cursor: 'pointer',
  columnGap: space.S200,
  paddingBlock: space.S200,
  paddingInline: space.S300,
  selectors: {
    '&[aria-selected="true"]': { backgroundColor: color.SurfaceVariant.Container },
    '&:hover:not([aria-selected="true"])': { backgroundColor: color.Surface.ContainerHover },
  },
});

export const OptionName = style({ flexGrow: 1, minInlineSize: 0, fontWeight: 600 });

/** The keys of the part that has the focus, at the window's foot. */
export const Hints = style({
  ...strip,
  flexWrap: 'wrap',
  gap: `${space.S100} ${space.S300}`,
  paddingBlock: space.S200,
  paddingInline: space.S300,
  color: color.SurfaceVariant.OnContainer,
  borderBlockStart: hairline,
  backgroundColor: color.SurfaceVariant.Container,
});

export const Hint = style({ ...strip, columnGap: space.S100 });

/** A key cap, as `ShortcutKeys` draws a shortcut's keys. */
export const Key = style({
  fontFamily: 'inherit',
  paddingInline: toRem(5),
  whiteSpace: 'nowrap',
  border: hairline,
  unicodeBidi: 'isolate',
  paddingBlock: toRem(1),
  borderRadius: radii.R300,
  backgroundColor: color.Surface.Container,
});
