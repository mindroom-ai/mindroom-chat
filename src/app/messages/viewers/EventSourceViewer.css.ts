import { globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

const MONO_FONT = "'JetBrains Mono', 'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace";

export const EventSourceViewer = style([
  DefaultReset,
  {
    display: 'flex',
    flexDirection: 'column',
    blockSize: '100%',
  },
]);

export const ViewerHeader = style({
  paddingInline: config.space.S200,
  paddingInlineStart: config.space.S400,
  gap: config.space.S200,
  flexShrink: 0,
});

// Matrix Quick-Copy Metadata Strip
export const MetaStrip = style({
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
  appearance: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  maxInlineSize: '100%',
  paddingBlock: toRem(2),
  paddingInline: config.space.S200,
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  font: 'inherit',
  fontSize: toRem(12),
  lineHeight: 1.4,
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      borderColor: color.Primary.ContainerLine,
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Other.FocusRing}`,
      outlineOffset: toRem(1),
    },
  },
});

// Declared after MetaChip so copied colors win specificity.
export const MetaChipCopied = style({
  borderColor: color.Success.ContainerLine,
  backgroundColor: color.Success.Container,
  color: color.Success.OnContainer,
  selectors: {
    '&:hover': {
      borderColor: color.Success.ContainerLine,
      backgroundColor: color.Success.Container,
    },
  },
});

export const MetaChipLabel = style({
  fontSize: toRem(10),
  fontWeight: config.fontWeight.W600,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  opacity: 0.72,
  flexShrink: 0,
});

export const MetaChipValue = style({
  fontFamily: MONO_FONT,
  fontSize: toRem(11.5),
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxInlineSize: '12rem',
  '@media': {
    '(max-width: 34rem)': {
      maxInlineSize: '7.5rem',
    },
  },
});

export const MetaBadge = style({
  display: 'inline-flex',
  alignItems: 'center',
  paddingBlock: toRem(2),
  paddingInline: config.space.S200,
  borderRadius: config.radii.R300,
  fontSize: toRem(11),
  fontWeight: config.fontWeight.W600,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  border: `${config.borderWidth.B300} solid transparent`,
});

export const MetaBadgeEdited = style([
  MetaBadge,
  {
    backgroundColor: color.Warning.Container,
    color: color.Warning.OnContainer,
    borderColor: color.Warning.ContainerLine,
  },
]);

export const MetaBadgeEncrypted = style([
  MetaBadge,
  {
    backgroundColor: color.Primary.Container,
    color: color.Primary.OnContainer,
    borderColor: color.Primary.ContainerLine,
  },
]);

// Sub-toolbar
export const SubToolbar = style({
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

export const DocTabs = style({
  display: 'inline-flex',
  alignItems: 'center',
  padding: toRem(2),
  gap: toRem(2),
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  flexShrink: 0,
});

export const DocTab = style({
  appearance: 'none',
  border: `${config.borderWidth.B300} solid transparent`,
  backgroundColor: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  opacity: 0.78,
  font: 'inherit',
  fontSize: toRem(12),
  fontWeight: config.fontWeight.W500,
  paddingBlock: toRem(2),
  paddingInline: config.space.S200,
  borderRadius: config.radii.R300,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  selectors: {
    '&:hover': {
      opacity: 1,
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    '&:focus-visible': {
      opacity: 1,
      outline: `${config.borderWidth.B600} solid ${color.Other.FocusRing}`,
    },
  },
});

// Declared after DocTab so selected styling wins specificity.
export const DocTabActive = style({
  opacity: 1,
  backgroundColor: color.Primary.Container,
  borderColor: color.Primary.ContainerLine,
  color: color.Primary.OnContainer,
  fontWeight: config.fontWeight.W600,
  selectors: {
    '&:hover': {
      backgroundColor: color.Primary.ContainerHover,
    },
  },
});

export const ToolbarButton = style({
  appearance: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  font: 'inherit',
  fontSize: toRem(12),
  fontWeight: config.fontWeight.W500,
  paddingBlock: toRem(3),
  paddingInline: config.space.S200,
  borderRadius: config.radii.R300,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  selectors: {
    '&:hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    '&[aria-pressed="true"]': {
      backgroundColor: color.Primary.Container,
      borderColor: color.Primary.ContainerLine,
      color: color.Primary.OnContainer,
      fontWeight: config.fontWeight.W600,
    },
    '&:disabled': {
      opacity: 0.45,
      cursor: 'default',
    },
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Other.FocusRing}`,
    },
  },
});

export const FilterGroup = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  flex: '1 1 9rem',
  minInlineSize: '7.5rem',
});

export const FilterInput = style({
  flex: '1 1 auto',
  minInlineSize: '6rem',
  blockSize: toRem(28),
  paddingBlock: 0,
  paddingInline: config.space.S200,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  font: 'inherit',
  fontSize: toRem(12),
  selectors: {
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Other.FocusRing}`,
      borderColor: color.Primary.Main,
    },
    '&:disabled': {
      opacity: 0.45,
    },
  },
});

export const FilterCount = style({
  fontSize: toRem(11.5),
  color: color.Surface.OnContainer,
  opacity: 0.72,
  whiteSpace: 'nowrap',
  flexShrink: 0,
});

// Code viewport canvas — keeps SurfaceVariant.Container for 4.5:1 WCAG token contrast.
export const ViewerContent = style({
  flexGrow: 1,
  minBlockSize: 0,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});

export const RawPre = style({
  margin: 0,
  padding: config.space.S300,
  fontFamily: MONO_FONT,
  fontSize: toRem(13),
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  tabSize: 4,
  background: 'transparent',
});

export const TreeRoot = style({
  paddingBlock: config.space.S300,
  paddingInline: config.space.S300,
  fontFamily: MONO_FONT,
  fontSize: toRem(13),
  lineHeight: 1.55,
  '@media': {
    '(max-width: 34rem)': {
      paddingInline: config.space.S200,
      fontSize: toRem(12),
    },
  },
});

export const TreeNode = style({
  display: 'block',
});

export const TreeLine = style({
  display: 'flex',
  alignItems: 'flex-start',
  borderRadius: config.radii.R300,
  paddingBlock: toRem(1),
  paddingInlineEnd: config.space.S100,
  minInlineSize: 0,
  selectors: {
    '&:hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
  },
});

export const TreeGutter = style({
  inlineSize: toRem(20),
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  userSelect: 'none',
});

export const FoldButton = style({
  appearance: 'none',
  border: 0,
  backgroundColor: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  opacity: 0.7,
  cursor: 'pointer',
  padding: 0,
  inlineSize: toRem(18),
  blockSize: toRem(20),
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: config.radii.R300,
  selectors: {
    '&:hover': {
      opacity: 1,
      backgroundColor: color.SurfaceVariant.ContainerActive,
    },
    '&:focus-visible': {
      opacity: 1,
      outline: `${config.borderWidth.B600} solid ${color.Other.FocusRing}`,
    },
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
  borderInlineStart: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  '@media': {
    '(max-width: 34rem)': {
      marginInlineStart: toRem(10),
      paddingInlineStart: toRem(4),
    },
  },
});

export const FoldPill = style({
  appearance: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  paddingBlock: 0,
  paddingInline: config.space.S100,
  marginInline: toRem(4),
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  fontFamily: 'inherit',
  fontSize: toRem(11),
  lineHeight: 1.45,
  cursor: 'pointer',
  verticalAlign: 'baseline',
  selectors: {
    '&:hover': {
      borderColor: color.Primary.ContainerLine,
      backgroundColor: color.Surface.ContainerHover,
    },
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Other.FocusRing}`,
    },
  },
});

export const StringPreviewBtn = style({
  appearance: 'none',
  border: 0,
  backgroundColor: 'transparent',
  padding: 0,
  font: 'inherit',
  color: 'inherit',
  cursor: 'pointer',
  textAlign: 'start',
  display: 'inline',
  overflowWrap: 'anywhere',
  selectors: {
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Other.FocusRing}`,
      borderRadius: config.radii.R300,
    },
  },
});

export const StringLenPill = style({
  appearance: 'none',
  display: 'inline-block',
  fontFamily: 'inherit',
  fontSize: toRem(11),
  lineHeight: 1.4,
  color: color.Surface.OnContainer,
  backgroundColor: color.Surface.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
  paddingBlock: 0,
  paddingInline: config.space.S100,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      borderColor: color.Primary.ContainerLine,
      backgroundColor: color.Surface.ContainerHover,
    },
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Other.FocusRing}`,
    },
  },
});

export const NoWrap = style({
  whiteSpace: 'nowrap',
});

export const TimestampHint = style({
  fontSize: toRem(11.5),
  opacity: 0.9,
});

export const MatchMark = style({
  backgroundColor: color.Warning.Container,
  color: color.Warning.OnContainer,
  borderRadius: toRem(2),
  paddingInline: toRem(1),
});

export const RowCopyBtn = style({
  appearance: 'none',
  border: `${config.borderWidth.B300} solid transparent`,
  backgroundColor: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  inlineSize: toRem(22),
  blockSize: toRem(20),
  padding: 0,
  marginInlineStart: config.space.S100,
  borderRadius: config.radii.R300,
  cursor: 'pointer',
  opacity: 0,
  flexShrink: 0,
  '@media': {
    '(pointer: coarse)': {
      opacity: 0.55,
      minInlineSize: toRem(28),
      minBlockSize: toRem(28),
    },
    '(max-width: 34rem)': {
      opacity: 0.55,
    },
  },
  selectors: {
    '&:hover': {
      opacity: 1,
      borderColor: color.SurfaceVariant.ContainerLine,
      backgroundColor: color.Surface.Container,
    },
    '&:focus-visible': {
      opacity: 1,
      outline: `${config.borderWidth.B600} solid ${color.Other.FocusRing}`,
    },
  },
});

// Declared after RowCopyBtn so copied state wins specificity.
export const RowCopyBtnCopied = style({
  opacity: 1,
  color: color.Success.OnContainer,
  borderColor: color.Success.ContainerLine,
  backgroundColor: color.Success.Container,
  selectors: {
    '&:hover': {
      opacity: 1,
      color: color.Success.OnContainer,
      borderColor: color.Success.ContainerLine,
      backgroundColor: color.Success.Container,
    },
  },
});

globalStyle(`${TreeLine}:hover ${RowCopyBtn}, ${TreeLine}:focus-within ${RowCopyBtn}`, {
  opacity: 0.85,
});

export const RowCopyIcon = style({
  inlineSize: toRem(13),
  blockSize: toRem(13),
});

export const EmptyFilter = style({
  paddingBlock: config.space.S400,
  paddingInline: config.space.S300,
  fontSize: toRem(13),
  color: color.SurfaceVariant.OnContainer,
  opacity: 0.78,
});
