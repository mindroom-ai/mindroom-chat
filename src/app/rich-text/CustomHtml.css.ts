import { globalStyle, style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';
import {
  CODE_TOKEN_TYPES,
  DARK_CODE_TOKEN_COLORS,
  ITALIC_CODE_TOKEN_ROLES,
  LIGHT_CODE_TOKEN_COLORS,
  type CodeTokenColors,
  type CodeTokenRole,
} from '../theme/codeTokenPalette';

// Styles for message HTML (`org.matrix.custom.html`) as the custom HTML parser renders it.

type ContainerTone = { Container: string; OnContainer: string; ContainerLine: string };

/** The corner radius of every chip-sized element: inline code, mentions, spoilers, toolbar buttons. */
const CHIP_RADIUS = config.radii.R300;

/** A box-shadow outline `width` wide in `tint`, drawn inside the box when `inset` is set. */
const ring = (width: string, tint: string, inset = false) =>
  `${inset ? 'inset ' : ''}0 0 0 ${width} ${tint}`;

/** Text and background colours of one container tone. */
const surfaceOf = (tone: Pick<ContainerTone, 'Container' | 'OnContainer'>) => ({
  color: tone.OnContainer,
  backgroundColor: tone.Container,
});

/** A flex row whose items share one centre line. */
const centeredRow = (gap: string) => ({ display: 'flex', alignItems: 'center', gap } as const);

/** An element that is `size` wide and tall. */
const square = (size: string) => ({ width: size, height: size });

/**
 * Vertical rhythm between blocks of a message: the same gap above and below, so a block keeps it
 * after a tool call row as after another block. The first and last blocks add no space at the
 * edges of the message.
 */
export const MarginSpaced = style({
  marginBlock: config.space.S200,
  selectors: {
    '&:first-child': { marginBlockStart: 0 },
    '&:last-child': { marginBlockEnd: 0 },
  },
});

export const Paragraph = style([MarginSpaced]);

export const Heading = style([
  MarginSpaced,
  {
    marginBlockStart: config.space.S300,
    selectors: {
      '&:first-child': { marginBlockStart: 0 },
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
  ...surfaceOf(color.SurfaceVariant),
  boxShadow: ring(config.borderWidth.B300, color.SurfaceVariant.ContainerLine, true),
  borderRadius: CHIP_RADIUS,
  paddingInline: toRem(4),
  fontFamily: codeFont,
  fontSize: '0.9em',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});

/** A fenced code block: a header with the language and actions above a scrolling body. */
export const CodeBlock = style({
  ...surfaceOf(color.SurfaceVariant),
  position: 'relative',
  display: 'flex',
  flexFlow: 'column',
  overflow: 'hidden',
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R400,
  whiteSpace: 'normal',
});

export const CodeBlockHeader = style({
  ...centeredRow(config.space.S200),
  justifyContent: 'space-between',
  padding: `${config.space.S100} ${config.space.S200}`,
  borderBottom: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const CodeBlockLabel = style({
  ...centeredRow(config.space.S100),
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
  ...square(toRem(14)),
  flex: 'none',
  color: 'var(--mr-code-icon-light)',
  selectors: {
    '.prism-dark &': { color: 'var(--mr-code-icon-dark)' },
  },
});

export const CodeBlockActions = style({
  ...centeredRow(toRem(2)),
  flex: 'none',
});

/**
 * An icon-only toolbar button; a pressed toggle (wrap) keeps the hover tint. To a finger it is
 * 44 px square in layout, so no layer reaches into the sticky thread banner above it.
 */
export const CodeBlockAction = style([
  {
    '@media': { '(pointer: coarse)': { minBlockSize: 44, minInlineSize: 44 } },
    display: 'inline-grid',
    placeItems: 'center',
    padding: config.space.S100,
    border: 0,
    borderRadius: CHIP_RADIUS,
    backgroundColor: 'transparent',
    color: 'inherit',
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
  },
]);

export const CodeBlockActionIcon = style(square(toRem(16)));

export const CodeBlockScroll = style({
  overflow: 'auto',
  borderEndStartRadius: `calc(${config.radii.R400} - ${config.borderWidth.B300})`,
  borderEndEndRadius: `calc(${config.radii.R400} - ${config.borderWidth.B300})`,
  // At its top or bottom the block hands the scroll on to the timeline. Sideways it keeps the
  // scroll, since the timeline does not scroll sideways and a trackpad swipe past the edge would
  // otherwise go back in the browser history.
  overscrollBehaviorInline: 'contain',
  selectors: {
    // Inside the box: the block clips anything drawn outside it.
    '&:focus-visible': {
      outline: 'none',
      boxShadow: ring(config.borderWidth.B600, color.Other.FocusRing, true),
    },
  },
});

export const CodeBlockInternal = style({
  margin: 0,
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  fontFamily: codeFont,
  fontSize: toRem(13),
  lineHeight: 1.5,
  whiteSpace: 'pre',
  tabSize: 4,
});

// Syntax colors of PrismCode's token spans: the theme puts `prism-light` or `prism-dark` on
// <body> (useTheme.ts), and each picks its set from codeTokenPalette.ts.
const codeTokenSchemes: ReadonlyArray<[string, CodeTokenColors]> = [
  ['prism-light', LIGHT_CODE_TOKEN_COLORS],
  ['prism-dark', DARK_CODE_TOKEN_COLORS],
];

codeTokenSchemes.forEach(([schemeClass, tokenColors]) => {
  (Object.keys(CODE_TOKEN_TYPES) as CodeTokenRole[]).forEach((role) => {
    const selector = CODE_TOKEN_TYPES[role]
      .map((type) => `.${schemeClass} .token.${type}`)
      .join(', ');
    globalStyle(selector, {
      color: tokenColors[role],
      fontStyle: ITALIC_CODE_TOKEN_ROLES.includes(role) ? 'italic' : undefined,
    });
  });
});

globalStyle('.token.bold', { fontWeight: 700 });
globalStyle('.token.italic', { fontStyle: 'italic' });
globalStyle('.token.namespace', { opacity: 0.75 });

// Fades a collapsed block's last visible lines into the block's background.
const SHADOW_HEIGHT = toRem(24);

export const CodeBlockBottomShadow = style({
  height: SHADOW_HEIGHT,
  position: 'sticky',
  insetBlockEnd: 0,
  marginTop: `calc(-1 * ${SHADOW_HEIGHT})`,
  pointerEvents: 'none',
  background: `linear-gradient(transparent, ${color.SurfaceVariant.Container})`,
});

// The chip surface, text and ring all come from one container tone.
const mentionTone = (tone: ContainerTone) => ({
  ...surfaceOf(tone),
  boxShadow: ring(config.borderWidth.B300, tone.ContainerLine),
});

export const Mention = recipe({
  base: {
    ...mentionTone(color.SurfaceVariant),
    cursor: 'pointer',
    display: 'inline',
    paddingBlock: 0,
    paddingInline: toRem(2),
    borderRadius: CHIP_RADIUS,
    fontWeight: config.fontWeight.W500,
    textDecoration: 'none',
  },
  // `focus` is declared last so its ring replaces the tone's outline when both apply.
  variants: {
    highlight: { true: mentionTone(color.Success) },
    focus: { true: { boxShadow: ring(config.borderWidth.B400, color.Other.FocusRing) } },
  },
});

/**
 * A link to a message, beside the `Mention` pill classes: one unbroken pill, cut short with an
 * ellipsis when it is wider than the message.
 */
export const MessageLinkPill = style({
  display: 'inline-block',
  verticalAlign: 'bottom',
  // Never wider than the message: a long room name ends in an ellipsis instead of a new line.
  maxWidth: '100%',
  whiteSpace: 'nowrap',
  // The text past the pill's end is hidden behind the ellipsis.
  textOverflow: 'ellipsis',
  overflow: 'hidden',
});

// The descendant rules need globalStyle, so the recipe takes both blocks as class names.
const SpoilerBase = style({
  color: 'transparent',
  backgroundColor: color.SurfaceVariant.ContainerActive,
  borderRadius: CHIP_RADIUS,
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
export const EmoticonBase = style({ display: 'inline-block', whiteSpace: 'nowrap' });

/**
 * A Unicode or custom emoji, scaled a little above the text; alone in a message it grows. The
 * scaled box is taller than a line of text, so it centers on the text's x-height and gives back
 * part of its height as negative block margins: the glyph keeps its size while the line it sits
 * in keeps the height of the lines around it.
 */
export const Emoticon = recipe({
  base: {
    display: 'inline-block',
    blockSize: '1.25em',
    minInlineSize: '1.25em',
    objectFit: 'contain',
    textAlign: 'center',
    fontSize: '1.33em',
    lineHeight: '1.25em',
    verticalAlign: 'middle',
    marginBlock: '-0.2em',
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
  ...surfaceOf(color.Warning),
  borderRadius: CHIP_RADIUS,
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
