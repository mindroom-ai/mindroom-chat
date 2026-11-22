import { createContainer, globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

const sheetViewport = createContainer();
// Too short to pin the title, the search, the filters, the moderator checkbox and the footer
// around a scrolling list: a phone with its keyboard up, or one held sideways.
const shortViewport = `${sheetViewport} (max-height: ${toRem(480)})`;

// On mobile Safari the fixed Overlay spans the layout viewport while the keyboard shrinks the
// visual viewport; the box follows --app-height and --app-viewport-offset-top
// (useMobileKeyboardViewportFix sets them only while a software keyboard does that) at every
// width, since a phone held sideways is as wide as a tablet. It always has a height of its own, so
// it can be the size container the sheet's short layout asks, without the dialog's height
// collapsing.
export const ViewportCenter = style({
  selectors: {
    '&&': {
      height: 'var(--app-height, 100%)',
      marginBlockStart: 'var(--app-viewport-offset-top, 0px)',
      containerName: sheetViewport,
      containerType: 'size',
    },
  },
});

export const Dialog = style({
  width: '100%',
  maxWidth: toRem(520),
  maxHeight: `min(${toRem(640)}, calc(var(--app-height, 100dvh) - ${toRem(48)}))`,
  display: 'flex',
  flexDirection: 'column',
  // A short viewport has no room for a margin above and below; a phone's sheet fills it anyway.
  '@container': { [shortViewport]: { maxHeight: '100%' } },
});

export const TitleBar = style({
  flexShrink: 0,
  height: 'auto',
  minHeight: toRem(56),
  gap: config.space.S200,
  paddingBlock: config.space.S200,
  paddingInlineStart: config.space.S400,
  paddingInlineEnd: config.space.S200,
  borderBlockEnd: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
});

export const TitleBlock = style({
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  minWidth: 0,
});

export const Controls = style({
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  paddingBlockStart: config.space.S300,
  paddingBlockEnd: config.space.S200,
  paddingInline: config.space.S400,
});

// The field draws its own Clear button, so the browser's search cancel mark stays hidden.
export const SearchField = style({});
globalStyle(`${SearchField} input::-webkit-search-cancel-button`, { display: 'none' });

export const FilterRow = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: config.space.S200,
});

export const FilterChip = style({
  '@media': { '(pointer: coarse)': { minBlockSize: toRem(38) } },
});

// Everything below the title. On a tall viewport the search, the filters, the moderator checkbox
// and the footer stay in place and only the rows scroll; on a short one they scroll together, so
// the search field, the checkbox, every row and the note can all be reached, in that order.
export const Body = style({
  flexGrow: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  '@container': {
    [shortViewport]: { overflowY: 'auto', overscrollBehavior: 'contain' },
  },
});

// Moderator grants that failed, between the controls and the rows. A long error or a row of them
// scrolls inside the strip, so the rows keep their room. No list: a list item here is a person.
export const GrantAlerts = style({
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  maxBlockSize: toRem(96),
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  marginInline: config.space.S400,
  marginBlockEnd: config.space.S200,
});

// The dismiss button stays at the top, in sight however long the message is.
export const GrantAlert = style({
  flexShrink: 0,
  display: 'flex',
  alignItems: 'flex-start',
  gap: config.space.S200,
  paddingBlock: config.space.S100,
  paddingInlineStart: config.space.S200,
  paddingInlineEnd: config.space.S100,
  borderRadius: config.radii.R300,
  backgroundColor: color.Critical.Container,
  color: color.Critical.OnContainer,
});

export const GrantAlertText = style({
  flexGrow: 1,
  alignSelf: 'center',
  minInlineSize: 0,
  overflowWrap: 'anywhere',
});

export const ListArea = style({
  flexGrow: 1,
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  paddingInline: config.space.S200,
  paddingBlockEnd: config.space.S200,
  '@container': {
    [shortViewport]: { flexShrink: 0, overflowY: 'visible' },
  },
});

export const SectionHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S200,
  paddingBlockStart: config.space.S200,
  paddingBlockEnd: config.space.S100,
  paddingInline: config.space.S200,
  fontWeight: config.fontWeight.W600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
});

export const List = style([
  DefaultReset,
  {
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: toRem(2),
  },
]);

export const Row = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S300,
  minBlockSize: toRem(48),
  paddingBlock: config.space.S100,
  paddingInline: config.space.S200,
  borderRadius: config.radii.R400,
  selectors: {
    '&:hover, &:focus-within': { backgroundColor: color.Surface.ContainerHover },
  },
});

export const AvatarWrap = style({
  flexShrink: 0,
});

export const Identity = style({
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  minInlineSize: 0,
});

export const NameLine = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  minInlineSize: 0,
});

export const AgentBadge = style({
  flexShrink: 0,
});

// An ID that no directory lists is the row's only name, so it wraps whole instead of truncating.
export const NameWrap = style({
  minInlineSize: 0,
  overflowWrap: 'anywhere',
});

export const Subtitle = style({
  minInlineSize: 0,
  overflowWrap: 'anywhere',
});

export const RowError = style({
  color: color.Critical.Main,
  overflowWrap: 'anywhere',
  marginBlockStart: toRem(2),
});

export const RowAction = style({
  flexShrink: 0,
  minWidth: toRem(88),
  '@media': { '(pointer: coarse)': { minBlockSize: toRem(38) } },
});

export const RowActionSent = style({
  vars: { [config.opacity.Disabled]: '1' },
  selectors: { '&[aria-disabled="true"]': { cursor: 'default' } },
});

export const InlineHint = style({
  paddingBlock: config.space.S200,
  paddingInline: config.space.S200,
  textAlign: 'center',
});

export const EmptyState = style({
  paddingBlock: config.space.S500,
  paddingInline: config.space.S400,
  textAlign: 'center',
});

export const DirectoryError = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: config.space.S200,
  paddingBlock: config.space.S500,
  paddingInline: config.space.S400,
  textAlign: 'center',
});

export const FetchingRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: config.space.S200,
  paddingBlock: config.space.S300,
  paddingInline: config.space.S200,
});

export const Footer = style({
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  paddingBlock: config.space.S300,
  paddingInline: config.space.S400,
  borderBlockStart: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
});

export const NoteToggle = style({
  alignSelf: 'flex-start',
  paddingBlock: config.space.S100,
  paddingInline: 0,
  border: 0,
  background: 'none',
  color: color.Surface.OnContainer,
  opacity: config.opacity.P400,
  font: 'inherit',
  cursor: 'pointer',
  borderRadius: config.radii.R300,
  selectors: {
    '&:hover, &:focus-visible': { opacity: 1 },
    '&:focus-visible': {
      outline: `${config.borderWidth.B400} solid ${color.Primary.Main}`,
      outlineOffset: config.borderWidth.B400,
    },
  },
});

export const ModeratorRow = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
});

export const ModeratorLabel = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  cursor: 'pointer',
});

export const VisuallyHidden = style({
  position: 'absolute',
  insetBlockStart: 0,
  insetInlineStart: 0,
  inlineSize: 1,
  blockSize: 1,
  margin: 0,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
});
