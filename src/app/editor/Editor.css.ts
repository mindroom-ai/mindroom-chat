import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassFloating, glassSurface } from '../ui/styles/Glass.css';

// Space above and below a line of text; the placeholder sits on the same line.
const textPaddingBlock = toRem(13);

// A floating glass card: the material draws its rim, so only focus adds a line inside it. The
// control level, as in room-light.png: a lighter tint and a soft shadow around the card.
export const Editor = style([
  glassSurface({ level: 'control', variant: 'SurfaceVariant' }),
  glassFloating,
  {
    overflow: 'hidden',
    borderRadius: config.radii.R400,
    color: color.SurfaceVariant.OnContainer,
    selectors: {
      '&:focus-within': {
        boxShadow: `inset 0 0 0 ${config.borderWidth.B300} color-mix(in srgb, ${color.Primary.Main} 45%, transparent)`,
      },
    },
  },
]);

export const EditorOptions = style({
  padding: config.space.S200,
});

// The text box scrolls only once its text is taller than it, so no scrollbar shows while the text
// fits. Chromium ignores the ::-webkit-scrollbar styles while scrollbar-width or scrollbar-color
// is set (index.css sets both everywhere) and draws its standard thin scrollbar, which has arrow
// buttons where scrollbars are classic; unset, the thin rounded thumb of those styles shows.
export const EditorTextareaScroll = style({
  flexGrow: 1,
  minWidth: 0,
  // Over folds' Scroll, which always scrolls.
  selectors: { '&&': { overflowY: 'auto' } },
  '@supports': {
    'selector(::-webkit-scrollbar)': { scrollbarWidth: 'auto', scrollbarColor: 'auto' },
  },
});

// The text writes at the size of a message body (MessageTextBody's T400), so it keeps its size
// from the composer to the thread.
export const EditorTextarea = style({
  fontSize: config.fontSize.T400,
  lineHeight: config.lineHeight.T400,
  letterSpacing: config.letterSpacing.T400,
  padding: `${textPaddingBlock} ${config.space.S100}`,
  outline: 'none',
  overflowWrap: 'anywhere',
  whiteSpace: 'pre-wrap',
});

globalStyle(`${EditorTextarea} p`, { margin: 0 });

// Slate puts the placeholder after the empty line's break, so it is lifted back onto that line.
export const EditorPlaceholder = style({
  position: 'absolute',
  top: textPaddingBlock,
  insetInline: config.space.S100,
  // A third of the text color: a hint, lighter than any text the user typed.
  opacity: 0.333,
  pointerEvents: 'none',
  userSelect: 'none',
});

// Chips, code and spoilers share one tinted, rounded surface.
const tintedSurface = {
  borderRadius: config.radii.R300,
  backgroundColor: color.SurfaceVariant.ContainerActive,
} as const;

// Mentions and paste badges: a tinted pill that keeps the line height of the text.
export const InlineChip = style({
  ...tintedSurface,
  cursor: 'default',
  paddingInline: toRem(3),
  whiteSpace: 'nowrap',
  fontWeight: config.fontWeight.W500,
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
  ...tintedSurface,
  margin: 0,
  fontFamily: 'var(--font-mono)',
  overflowX: 'auto',
  padding: `${config.space.S100} ${config.space.S200}`,
});

export const BlockQuote = style({
  margin: 0,
  paddingInlineStart: config.space.S200,
  borderInlineStart: `${config.borderWidth.B700} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const Spoiler = style(tintedSurface);

export const InlineCode = style({
  ...tintedSurface,
  fontFamily: 'var(--font-mono)',
  fontSize: '0.9em',
  paddingInline: toRem(3),
});
