import { createContainer, createVar, fallbackVar, globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { glassFloating, glassSurface } from '../ui/styles/Glass.css';
import { shortRoomArea } from '../ui/styles/roomArea.css';
import { shortViewport } from '../ui/styles/shortViewport';

// Space above and below a line of text; the placeholder sits on the same line.
const textPaddingBlock = toRem(13);
// The text's padding, which a stacked layout changes: the placeholder follows the top one.
const textPaddingTop = createVar();
const textPaddingBottom = createVar();
const textPaddingInline = createVar();
/** The text box's least height, which a stacked layout sets to two lines (`textMinHeightStyle`). */
const textMinHeight = createVar();
/** For the text box's own style: Slate's inline minimum would otherwise override a class. */
export const textMinHeightStyle = { minHeight: fallbackVar(textMinHeight, '0px') };
// The bottom slot (the formatting toolbar): its padding, whether its row may wrap, and the
// display of the hairline before it, which a stacked layout wide enough to hold it on the
// controls row changes.
const bottomPadding = createVar();
const bottomWrap = createVar();
const bottomRule = createVar();

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

// The frame of a composer with a layout, which its stacked layout measures. Its width comes from
// its parent, never from its content.
const frame = createContainer();
export const EditorFrame = style({ containerName: frame, containerType: 'inline-size' });

// The controls row holds the formatting toolbar beside its controls from this width on: the
// widest leading controls (8 px padding, a model button with six effort bars 58, 4 gap, the 1 px
// divider, 4 gap, attach, microphone and Formatting 32 each with 4 gaps, 8 px padding: 187 px),
// the toolbar (8 gap, the 1 px hairline, 8 gap, eleven 26 px buttons, its own 1 px line and
// eleven 4 px gaps: 340 px) and the trailing ones (8, emoji 32, 4, Send 32, 8: 84 px) make
// 611 px, 38.2rem; the rest is slack.
const inlineBottomWidth = '40rem';

export const EditorOptions = style({
  padding: config.space.S200,
});

// One row: the controls beside the text box, the bottom row under all three.
const rowAreas = '"before text after" "bottom bottom bottom"';
const rowLayout = {
  vars: {
    [textPaddingTop]: textPaddingBlock,
    [textPaddingBottom]: textPaddingBlock,
    [textPaddingInline]: '0px',
    [textMinHeight]: '0px',
    [bottomPadding]: `0 ${config.space.S200} ${config.space.S200}`,
    [bottomWrap]: 'wrap',
    [bottomRule]: 'none',
  },
  gridTemplateAreas: rowAreas,
};

/**
 * The composer's frame as a grid, so it changes between one row and two without moving the
 * text box in the document (which would take its focus and its selection).
 */
export const EditorGrid = style({
  ...rowLayout,
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  alignItems: 'start',
});

// Two rows, as in T3 Code: the text on top, at least two lines tall, inset from the frame; the
// bottom row (the formatting toolbar) under it; the controls in a row of their own at the
// bottom, the leading ones at the start and the trailing ones at the end. A frame wide enough
// puts the toolbar on the controls row instead, after the leading controls (its Formatting
// button), so the composer does not grow. A phone held sideways is too short for two rows, and
// so is a room area its keyboard leaves short (which no media query sees under Safari's
// keyboard): both keep one row, and come after the wide frame's rule to win over it.
export const EditorGridStacked = style({
  vars: {
    [textPaddingTop]: config.space.S300,
    [textPaddingBottom]: config.space.S100,
    [textPaddingInline]: config.space.S300,
    [textMinHeight]: `calc(2 * ${config.lineHeight.T400} + ${config.space.S300} + ${config.space.S100})`,
  },
  gridTemplateAreas: '"text text text" "bottom bottom bottom" "before . after"',
  alignItems: 'center',
  '@media': { [shortViewport]: { ...rowLayout, alignItems: 'start' } },
  '@container': {
    [`${frame} (min-width: ${inlineBottomWidth})`]: {
      vars: { [bottomPadding]: '0', [bottomWrap]: 'nowrap', [bottomRule]: 'block' },
      gridTemplateAreas: '"text text text" "before bottom after"',
      '@media': { [shortViewport]: { ...rowLayout, alignItems: 'start' } },
    },
    [shortRoomArea]: { ...rowLayout, alignItems: 'start' },
  },
});

export const EditorSlotBefore = style({ gridArea: 'before' });
export const EditorSlotText = style({ gridArea: 'text', alignSelf: 'stretch' });
export const EditorSlotAfter = style({ gridArea: 'after' });
export const EditorSlotBottom = style({
  gridArea: 'bottom',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  padding: bottomPadding,
  flexWrap: bottomWrap,
  selectors: {
    // The hairline between the Formatting button and its toolbar, as the toolbar's own line.
    '&::before': {
      content: '""',
      display: bottomRule,
      flexShrink: 0,
      width: config.borderWidth.B300,
      height: toRem(20),
      backgroundColor: color.SurfaceVariant.ContainerLine,
    },
  },
});

// The text box scrolls only once its text is taller than it, so no scrollbar shows while the text
// fits. Chromium ignores the ::-webkit-scrollbar styles while scrollbar-width or scrollbar-color
// is set (index.css sets both everywhere) and draws its standard thin scrollbar, which has arrow
// buttons where scrollbars are classic; unset, the thin rounded thumb of those styles shows.
export const EditorTextareaScroll = style({
  flexGrow: 1,
  minWidth: 0,
  paddingInline: fallbackVar(textPaddingInline, '0px'),
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
  padding: `${fallbackVar(textPaddingTop, textPaddingBlock)} ${config.space.S100} ${fallbackVar(
    textPaddingBottom,
    textPaddingBlock
  )}`,
  outline: 'none',
  overflowWrap: 'anywhere',
  whiteSpace: 'pre-wrap',
});

globalStyle(`${EditorTextarea} p`, { margin: 0 });

// Slate puts the placeholder after the empty line's break, so it is lifted back onto that line.
export const EditorPlaceholder = style({
  position: 'absolute',
  top: fallbackVar(textPaddingTop, textPaddingBlock),
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

// Markdown syntax typed in the text, such as `**` or a link's URL: kept as text, at the text's
// size so nothing moves when a span completes, and faded as the placeholder is, a little less.
export const MarkdownMarker = style({
  opacity: 0.5,
});

export const MarkdownLink = style({
  color: color.Primary.Main,
  textDecoration: 'underline',
});

export const InlineCode = style({
  ...tintedSurface,
  fontFamily: 'var(--font-mono)',
  fontSize: '0.9em',
  paddingInline: toRem(3),
});
