import { globalStyle, style, type StyleRule } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

const MONO_FONT = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)';
const BORDER = `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`;
const TRANSPARENT_BORDER = `${config.borderWidth.B300} solid transparent`;
const FOCUS_RING = { outline: `${config.borderWidth.B600} solid ${color.Other.FocusRing}` };
const DISABLED = { opacity: 0.45, cursor: 'default' };
const SMALL_SCREEN = '(max-width: 34rem)';
const INLINE_FLEX: StyleRule = { display: 'inline-flex', alignItems: 'center' };
const PRIMARY_ACTIVE = {
  backgroundColor: color.Primary.Container,
  borderColor: color.Primary.ContainerLine,
  color: color.Primary.OnContainer,
  fontWeight: config.fontWeight.W600,
};
const SUCCESS_COPIED = {
  borderColor: color.Success.ContainerLine,
  backgroundColor: color.Success.Container,
  color: color.Success.OnContainer,
};
const SURFACE_VARIANT_BOX: StyleRule = {
  border: BORDER,
  borderRadius: config.radii.R300,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
};
const BUTTON_BASE: StyleRule = {
  appearance: 'none',
  font: 'inherit',
  borderRadius: config.radii.R300,
  cursor: 'pointer',
};
const INTERACTIVE_CHIP: StyleRule = {
  ...BUTTON_BASE,
  ...SURFACE_VARIANT_BOX,
  ...INLINE_FLEX,
  gap: config.space.S100,
  fontSize: toRem(12),
  paddingInline: config.space.S200,
};
const CODE_CANVAS: StyleRule = {
  direction: 'ltr',
  unicodeBidi: 'isolate',
  fontFamily: MONO_FONT,
  fontSize: toRem(13),
  lineHeight: 1.55,
};
const ICON_BTN_BASE: StyleRule = {
  ...BUTTON_BASE,
  ...INLINE_FLEX,
  justifyContent: 'center',
  padding: 0,
  backgroundColor: 'transparent',
  color: color.SurfaceVariant.OnContainer,
};
const INLINE_PILL_BASE: StyleRule = {
  ...BUTTON_BASE,
  border: BORDER,
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  fontFamily: 'inherit',
  fontSize: toRem(11),
  paddingBlock: 0,
  paddingInline: config.space.S100,
};
const INLINE_PILL_HOVER = {
  borderColor: color.Primary.ContainerLine,
  backgroundColor: color.Surface.ContainerHover,
};
const badge = (tone: typeof color.Warning | typeof color.Primary) =>
  style({
    ...INLINE_FLEX,
    paddingBlock: toRem(2),
    paddingInline: config.space.S200,
    borderRadius: config.radii.R300,
    fontSize: toRem(11),
    fontWeight: config.fontWeight.W600,
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
    border: `${config.borderWidth.B300} solid ${tone.ContainerLine}`,
    backgroundColor: tone.Container,
    color: tone.OnContainer,
  });
const copiedStyle = (extra?: StyleRule) =>
  style({
    ...extra,
    ...SUCCESS_COPIED,
    selectors: { '&:hover': { ...extra, ...SUCCESS_COPIED } },
  });

export const EventSourceViewer = style([
  DefaultReset,
  { display: 'flex', flexDirection: 'column', blockSize: '100%' },
]);
export const ViewerHeader = style({
  paddingInline: config.space.S200,
  paddingInlineStart: config.space.S400,
  gap: config.space.S200,
  flexShrink: 0,
});
export const StripBar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: config.space.S100,
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  borderBlockEnd: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  backgroundColor: color.Surface.Container,
  flexShrink: 0,
});

export const MetaChip = style({
  ...INTERACTIVE_CHIP,
  maxInlineSize: '100%',
  paddingBlock: toRem(2),
  lineHeight: 1.4,
  selectors: {
    '&:hover': {
      borderColor: color.Primary.ContainerLine,
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    '&:focus-visible': { ...FOCUS_RING, outlineOffset: toRem(1) },
  },
});
// Declared after MetaChip so copied colors win specificity.
export const MetaChipCopied = copiedStyle();
export const MetaChipLabel = style({
  fontSize: toRem(10),
  fontWeight: config.fontWeight.W600,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  flexShrink: 0,
});
export const MetaChipValue = style({
  fontFamily: MONO_FONT,
  fontSize: toRem(11.5),
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxInlineSize: '12rem',
  '@media': { [SMALL_SCREEN]: { maxInlineSize: '7.5rem' } },
});
export const MetaChipValueTechnical = style({ direction: 'ltr', unicodeBidi: 'isolate' });
export const MetaBadgeEdited = badge(color.Warning);
export const MetaBadgeEncrypted = badge(color.Primary);

export const DocTabs = style({
  ...SURFACE_VARIANT_BOX,
  ...INLINE_FLEX,
  flexWrap: 'wrap',
  maxInlineSize: '100%',
  padding: toRem(2),
  gap: toRem(2),
});
export const DocTab = style({
  ...INTERACTIVE_CHIP,
  border: TRANSPARENT_BORDER,
  backgroundColor: 'transparent',
  fontWeight: config.fontWeight.W500,
  paddingBlock: toRem(2),
  whiteSpace: 'nowrap',
  selectors: {
    '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover },
    '&:focus-visible': FOCUS_RING,
  },
});
// Declared after DocTab so selected styling wins specificity.
export const DocTabActive = style({
  ...PRIMARY_ACTIVE,
  selectors: { '&:hover': { backgroundColor: color.Primary.ContainerHover } },
});
export const ToolbarButton = style({
  ...INTERACTIVE_CHIP,
  fontWeight: config.fontWeight.W500,
  paddingBlock: toRem(3),
  whiteSpace: 'nowrap',
  selectors: {
    '&:hover:not(:disabled)': { backgroundColor: color.SurfaceVariant.ContainerHover },
    '&[aria-pressed="true"]': PRIMARY_ACTIVE,
    '&[aria-pressed="true"]:hover:not(:disabled)': {
      backgroundColor: color.Primary.ContainerHover,
    },
    '&:disabled': DISABLED,
    '&:focus-visible': FOCUS_RING,
  },
});

export const FilterGroup = style({
  ...INLINE_FLEX,
  gap: config.space.S200,
  flex: '1 1 9rem',
  minInlineSize: '7.5rem',
});
export const FilterInput = style({
  ...SURFACE_VARIANT_BOX,
  flex: '1 1 auto',
  minInlineSize: '6rem',
  blockSize: toRem(28),
  paddingBlock: 0,
  paddingInline: config.space.S200,
  font: 'inherit',
  fontSize: toRem(12),
  selectors: {
    '&:focus-visible': { ...FOCUS_RING, borderColor: color.Primary.Main },
    '&:disabled': { opacity: 0.45 },
  },
});
export const FilterCount = style({
  fontSize: toRem(11.5),
  color: color.Surface.OnContainer,
  marginInlineStart: config.space.S100,
  whiteSpace: 'nowrap',
  flexShrink: 0,
});

export const ViewerContent = style({
  flexGrow: 1,
  minBlockSize: 0,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});
export const RawPre = style({
  ...CODE_CANVAS,
  margin: 0,
  padding: config.space.S300,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  tabSize: 4,
  background: 'transparent',
});
export const TreeRoot = style({
  ...CODE_CANVAS,
  padding: config.space.S300,
  '@media': { [SMALL_SCREEN]: { paddingInline: config.space.S200, fontSize: toRem(12) } },
});
export const TreeLine = style({
  display: 'flex',
  alignItems: 'flex-start',
  borderRadius: config.radii.R300,
  paddingBlock: toRem(1),
  paddingInlineEnd: config.space.S100,
  minInlineSize: 0,
  selectors: { '&:hover, &:focus-within': { boxShadow: `inset 2px 0 0 ${color.Primary.Main}` } },
});
export const TreeGutter = style({
  ...INLINE_FLEX,
  inlineSize: toRem(20),
  flexShrink: 0,
  justifyContent: 'center',
  userSelect: 'none',
});
export const FoldButton = style({
  ...ICON_BTN_BASE,
  border: 0,
  inlineSize: toRem(18),
  blockSize: toRem(20),
  selectors: {
    '&:hover:not(:disabled)': { backgroundColor: color.SurfaceVariant.ContainerActive },
    '&:disabled': DISABLED,
    '&:focus-visible': FOCUS_RING,
  },
});
export const TreeText = style({
  flex: 1,
  minInlineSize: 0,
  overflowWrap: 'anywhere',
  whiteSpace: 'pre-wrap',
  textAlign: 'start',
});
export const TreeChildren = style({
  marginInlineStart: toRem(14),
  paddingInlineStart: toRem(6),
  borderInlineStart: BORDER,
  '@media': { [SMALL_SCREEN]: { marginInlineStart: toRem(10), paddingInlineStart: toRem(4) } },
});
export const FoldPill = style({
  ...INLINE_PILL_BASE,
  ...INLINE_FLEX,
  marginInline: toRem(4),
  lineHeight: 1.45,
  verticalAlign: 'baseline',
  selectors: { '&:hover': INLINE_PILL_HOVER, '&:focus-visible': FOCUS_RING },
});
export const StringPreviewBtn = style({
  ...BUTTON_BASE,
  border: 0,
  backgroundColor: 'transparent',
  padding: 0,
  color: 'inherit',
  textAlign: 'start',
  display: 'inline',
  overflowWrap: 'anywhere',
  selectors: { '&:focus-visible': { ...FOCUS_RING, borderRadius: config.radii.R300 } },
});
export const StringLenPill = style({
  ...INLINE_PILL_BASE,
  display: 'inline-block',
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  selectors: {
    '&:hover:not(:disabled)': INLINE_PILL_HOVER,
    '&:disabled': DISABLED,
    '&:focus-visible': FOCUS_RING,
  },
});
export const StringPillWrap = style({
  display: 'inline-flex',
  alignItems: 'baseline',
  marginInlineStart: toRem(6),
  whiteSpace: 'nowrap',
});
export const TimestampHint = style({ fontSize: toRem(11.5) });
export const MatchMark = style({
  backgroundColor: color.Warning.Container,
  color: color.Warning.OnContainer,
  borderRadius: toRem(2),
  paddingInline: toRem(1),
});
export const RowCopyBtn = style({
  ...ICON_BTN_BASE,
  border: TRANSPARENT_BORDER,
  inlineSize: toRem(22),
  blockSize: toRem(20),
  marginInlineStart: config.space.S100,
  opacity: 0,
  flexShrink: 0,
  '@media': {
    '(pointer: coarse)': { opacity: 0.55, minInlineSize: toRem(28), minBlockSize: toRem(28) },
    [SMALL_SCREEN]: { opacity: 0.55 },
  },
  selectors: {
    '&:hover': {
      opacity: 1,
      borderColor: color.SurfaceVariant.ContainerLine,
      backgroundColor: color.Surface.Container,
    },
    '&:focus-visible': { opacity: 1, ...FOCUS_RING },
  },
});
// Declared after RowCopyBtn so copied state wins specificity.
export const RowCopyBtnCopied = copiedStyle({ opacity: 1 });

globalStyle(`:is(${TreeLine}:hover, ${TreeLine}:focus-within) ${RowCopyBtn}`, { opacity: 0.85 });
globalStyle(
  `:is(${TreeLine}:hover, ${TreeLine}:focus-within) :is(${RowCopyBtn}:hover, ${RowCopyBtn}:focus-visible, ${RowCopyBtnCopied})`,
  { opacity: 1 }
);

export const RowCopyIcon = style({ inlineSize: toRem(13), blockSize: toRem(13) });
export const EmptyFilter = style({
  paddingBlock: config.space.S400,
  paddingInline: config.space.S300,
  fontSize: toRem(13),
  color: color.SurfaceVariant.OnContainer,
});
