import { globalStyle, style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';

// Styles for message HTML (`org.matrix.custom.html`) as the custom HTML parser renders it.

/** Vertical rhythm between blocks of a message; the last block adds no space under the message. */



  selectors: {
    '&:last-child': { marginBottom: 0 },
  },
});

export const Paragraph = style([MarginSpaced]);

export const Heading = style([
  MarginSpaced,
  {
    marginTop: config.space.S300,
    selectors: {
      '&:first-child': { marginTop: 0 },
    },
  },
]);

// A quote reads as indented text behind a line in the container's line colour.
export const BlockQuote = style([
  MarginSpaced,
  {
    paddingInlineStart: config.space.S300,
    borderInlineStart: `${config.borderWidth.B700} solid ${color.SurfaceVariant.ContainerLine}`,
    color: color.Surface.OnContainer,
  },
]);

export const List = style([
  MarginSpaced,
  {
    paddingInlineStart: toRem(22),
    listStylePosition: 'outside',
  },
]);

const codeFont = "'JetBrains Mono', 'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace";

/** Inline code: a small tinted chip that wraps with the text around it. */
export const Code = style({




  paddingInline: toRem(4),
  fontFamily: codeFont,
  fontSize: '0.9em',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});

/** A fenced code block: a header with the language and actions above a scrolling body. */










    whiteSpace: 'normal',
  },
]);

/** A code block inside a message bubble, which has its own padding. */
export const MessageCodeBlock = style({
  width: '100%',
});

export const CodeBlockHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S200,
  padding: `${config.space.S100} ${config.space.S200}`,
  borderBottom: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const CodeBlockLabel = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
});

export const CodeBlockLabelText = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: codeFont,
  fontSize: toRem(12),
  opacity: 0.8,
});

// Each language icon carries both tints; the prism theme class on the page picks one.
export const CodeBlockLanguageIcon = style({



  color: 'var(--mr-code-icon-light)',
  selectors: {
    '.prism-dark &': { color: 'var(--mr-code-icon-dark)' },
  },
});

export const CodeBlockActions = style({
  display: 'flex',



});

/** An icon-only toolbar button; a pressed toggle (wrap) keeps the hover tint. */
export const CodeBlockAction = style({








  opacity: 0.7,
  cursor: 'pointer',
  selectors: {
    '&:hover, &[aria-pressed="true"]': {
      opacity: 1,
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    '&:focus-visible': {
      opacity: 1,
      outline: `${config.borderWidth.B600} solid ${color.Other.FocusRing}`,
    },
  },
});

export const CodeBlockActionIcon = style({
  width: toRem(16),
  height: toRem(16),
});

export const CodeBlockScroll = style({
  overflow: 'auto',
  maxHeight: toRem(480),
});




  fontFamily: codeFont,
  fontSize: toRem(13),
  lineHeight: 1.5,
  whiteSpace: 'pre',
  tabSize: 4,
});

// Fades a collapsed block's last visible lines into the block's background.



  insetBlockEnd: 0,
  marginTop: `calc(-1 * ${toRem(24)})`,
  pointerEvents: 'none',
  background: `linear-gradient(transparent, ${color.SurfaceVariant.Container})`,
});

type ContainerTone = { Container: string; OnContainer: string; ContainerLine: string };

const ring = (width: string, tint: string) => `0 0 0 ${width} ${tint}`;

// The chip surface, text and ring all come from one container tone.
const mentionTone = (tone: ContainerTone) => ({
  color: tone.OnContainer,
  backgroundColor: tone.Container,
  boxShadow: ring(config.borderWidth.B300, tone.ContainerLine),
});

export const Mention = recipe({
  base: {
    ...mentionTone(color.SurfaceVariant),
    cursor: 'pointer',
    display: 'inline',
    paddingBlock: 0,
    paddingInline: toRem(2),
    borderRadius: config.radii.R300,
    fontWeight: config.fontWeight.W500,
    textDecoration: 'none',
  },
  // `focus` is declared last so its ring replaces the tone's outline when both apply.
  variants: {
    highlight: { true: mentionTone(color.Success) },
    focus: { true: { boxShadow: ring(config.borderWidth.B400, color.Other.FocusRing) } },
  },
});

// The descendant rules need globalStyle, so the recipe takes both blocks as class names.
const SpoilerBase = style({
  color: 'transparent',
  backgroundColor: color.SurfaceVariant.ContainerActive,
  borderRadius: config.radii.R300,
  paddingInline: toRem(2),
  cursor: 'pointer',
});
globalStyle(`${SpoilerBase} *`, { visibility: 'hidden' });

const SpoilerActive = style({
  color: 'inherit',
  cursor: 'auto',
});
globalStyle(`${SpoilerActive} *`, { visibility: 'visible' });

export const Spoiler = recipe({
  base: SpoilerBase,
  variants: {
    active: {
      true: SpoilerActive,
    },
  },
});

/** The inline wrapper of a custom (`data-mx-emoticon`) image emoji. */
export const EmoticonBase = style({








    textAlign: 'center',
    objectFit: 'contain',
    height: '1.25em',
    minWidth: '1.25em',
    fontSize: '1.33em',
    lineHeight: 1,
    verticalAlign: '-0.3em',
  },
  variants: {
    jumbo: {
      true: {
        fontSize: '2.5em',
      },
    },
  },
});

// A search match inside a message.
export const highlightText = style({



  boxShadow: ring(toRem(1), color.Warning.Container),
});

export const Table = style([
  MarginSpaced,
  {
    borderCollapse: 'collapse',
  },
]);

globalStyle(`${Table} th, ${Table} td`, {
  padding: `${config.space.S100} ${config.space.S200}`,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  textAlign: 'start',
});

globalStyle(`${Table} th`, {
  fontWeight: config.fontWeight.W600,
  backgroundColor: color.SurfaceVariant.Container,
});
