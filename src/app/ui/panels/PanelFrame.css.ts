import { globalStyle, keyframes, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { Panel } from './ResizablePanel.css';

/** The width of the folded edge tab at a panel's start edge. */
export const STRIP_WIDTH = 40;

// A column at the start of a legacy `title: 'own'` panel's box, before its content, holding Fill
// and Fold while open when the panel has not opted into `frameControls: 'own'`.
export const Strip = style({
  display: 'flex',
  flexFlow: 'column',
  alignItems: 'center',
  gap: config.space.S100,
  paddingBlock: config.space.S200,
  overflow: 'hidden',
  blockSize: '100%',
  backgroundColor: color.Surface.Container,
  borderInlineEnd: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

// Folded, the tab is all of the panel that shows: a vertical column at the room's end edge that
// brings the panel back beside the conversation.
export const Tab = style({
  display: 'flex',
  flexFlow: 'column',
  alignItems: 'center',
  gap: config.space.S100,
  paddingBlock: config.space.S200,
  overflow: 'hidden',
  blockSize: '100%',
  border: 'none',
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  font: 'inherit',
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: color.Surface.ContainerHover },
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
      outlineOffset: `calc(-1 * ${config.borderWidth.B600})`,
    },
  },
});

// The panel's box gives its content its own width; the tab and legacy open strip keep their own,
// as their width too: folded, the box takes the width of what it holds, and WebKit counts a flex
// item's width there, not its flex basis.
globalStyle(`${Panel} > :first-child > :is(${Tab}, ${Strip})`, {
  flex: `0 0 ${STRIP_WIDTH}px`,
  width: STRIP_WIDTH,
});
// Folded, the box holds only the tab; the content stays mounted, out of sight.
globalStyle(`${Panel}[data-folded] > :first-child > :not(${Tab})`, { display: 'none' });

export const TabLabel = style({
  writingMode: 'vertical-rl',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

// Rounded pill surface and >= 32 px button hit targets for bordered header pills (such as
// CanvasPanel's VersionPill).
export const HeaderPill = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(2),
  padding: toRem(2),
  borderRadius: config.radii.R400,
  backgroundColor: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

// Keep compact icons visually crisp while preserving a >= 32 px hit target (including on phones).
globalStyle(`${HeaderPill} button`, {
  minInlineSize: toRem(32),
  minBlockSize: toRem(32),
});

// Flat, borderless header controls at the end of a side panel's header: panel-specific actions,
// then frame controls (Fill, Fold) and Close. Wraps cleanly if a narrow panel has extra controls.
export const ControlPill = style({
  display: 'inline-flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: toRem(2),
  flexShrink: 0,
  marginInlineStart: 'auto',
  maxInlineSize: '100%',
});

globalStyle(`${ControlPill} button`, {
  minInlineSize: toRem(32),
  minBlockSize: toRem(32),
});

export const ControlExtras = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(2),
  selectors: {
    '&:empty': { display: 'none' },
  },
});

export const ControlCore = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(2),
  flexShrink: 0,
});

export const ControlSeparator = style({
  inlineSize: config.borderWidth.B300,
  blockSize: toRem(16),
  marginInline: toRem(4),
  flexShrink: 0,
  backgroundColor: color.Surface.ContainerLine,
  selectors: {
    [`${ControlExtras}:empty + &`]: { display: 'none' },
    '&:last-child': { display: 'none' },
  },
});

const fillButtonPulse = keyframes({
  '0%': {
    backgroundColor: `color-mix(in srgb, ${color.Primary.Main} 24%, transparent)`,
    color: color.Primary.Main,
    boxShadow: `0 0 0 0 color-mix(in srgb, ${color.Primary.Main} 55%, transparent)`,
    transform: 'scale(1.08)',
  },
  '45%': {
    backgroundColor: `color-mix(in srgb, ${color.Primary.Main} 16%, transparent)`,
    color: color.Primary.Main,
    boxShadow: `0 0 0 5px color-mix(in srgb, ${color.Primary.Main} 0%, transparent)`,
    transform: 'scale(1)',
  },
  '100%': {
    backgroundColor: 'transparent',
    boxShadow: '0 0 0 0 transparent',
    transform: 'scale(1)',
  },
});

// Fill/Shrink button lights up while dragging past maxWidth and pulses briefly on landing in full width.
globalStyle(`${Panel} [data-panel-fill-button]`, {
  transition: 'background-color 140ms ease, color 140ms ease, box-shadow 140ms ease',
  '@media': {
    '(prefers-reduced-motion: reduce)': { transition: 'none' },
  },
});

globalStyle(`${Panel}[data-expand-highlight] [data-panel-fill-button]`, {
  backgroundColor: `color-mix(in srgb, ${color.Primary.Main} 16%, transparent)`,
  color: color.Primary.Main,
  boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color.Primary.Main} 75%, transparent)`,
});

globalStyle(`${Panel}[data-just-filled] [data-panel-fill-button]`, {
  animation: `${fillButtonPulse} 700ms cubic-bezier(0.2, 0, 0, 1)`,
  '@media': {
    '(prefers-reduced-motion: reduce)': { animation: 'none' },
  },
});
