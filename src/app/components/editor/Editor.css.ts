import { createVar, globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// The frame line is drawn inside the box, so it takes no layout space.
const editorFrameLine = createVar();

export const Editor = style({
  vars: { [editorFrameLine]: color.SurfaceVariant.ContainerLine },
  overflow: 'hidden',
  borderRadius: config.radii.R400,
  boxShadow: `inset 0 0 0 ${config.borderWidth.B300} ${editorFrameLine}`,
  color: color.SurfaceVariant.OnContainer,
  backgroundColor: color.SurfaceVariant.Container,
});

export const EditorOptions = style({
  padding: config.space.S200,
});

export const EditorTextareaScroll = style({
  flexGrow: 1,
  minWidth: 0,
});

export const EditorTextarea = style({
  padding: `${toRem(13)} ${config.space.S100}`,
  outline: 'none',
  overflowWrap: 'anywhere',
  whiteSpace: 'pre-wrap',
});

globalStyle(`${EditorTextarea} p`, { margin: 0 });

export const EditorPlaceholder = style({
  position: 'absolute',
  opacity: config.opacity.Placeholder,
  pointerEvents: 'none',
  userSelect: 'none',
});

// Mentions, commands and paste badges: a tinted pill that keeps the line height of the text.
export const InlineChip = style({





  paddingInline: toRem(3),
});

export const InlineChipHighlight = style({
  backgroundColor: color.Primary.Container,
  color: color.Primary.OnContainer,
});

export const InlineChipSelected = style({
  boxShadow: `0 0 0 ${config.borderWidth.B300} ${color.Primary.Main}`,
});

export const Emoticon = style({
  display: 'inline-block',
  height: '1.25em',
  verticalAlign: 'text-bottom',
});

export const CodeBlock = style({
  margin: 0,
  fontFamily: 'var(--font-mono)',
  overflowX: 'auto',



});

export const BlockQuote = style({
  margin: 0,
  paddingInlineStart: config.space.S200,
  borderInlineStart: `${config.borderWidth.B700} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const Spoiler = style({
  backgroundColor: color.SurfaceVariant.ContainerActive,
  borderRadius: config.radii.R300,
});

export const InlineCode = style({
  fontFamily: 'var(--font-mono)',
  fontSize: '0.9em',
  backgroundColor: color.SurfaceVariant.ContainerActive,
  borderRadius: config.radii.R300,
  paddingInline: toRem(3),
});
