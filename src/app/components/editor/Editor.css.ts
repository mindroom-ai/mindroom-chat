import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';









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
  selectors: {
    '& p': { margin: 0 },
  },
});

export const EditorPlaceholder = style({
  position: 'absolute',
  opacity: config.opacity.Placeholder,
  pointerEvents: 'none',
  userSelect: 'none',
});

export const InlineChip = style({






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





});

export const BlockQuote = style({



});

export const Spoiler = style({
  backgroundColor: color.SurfaceVariant.ContainerActive,
  borderRadius: config.radii.R300,
});

export const InlineCode = style({




});
