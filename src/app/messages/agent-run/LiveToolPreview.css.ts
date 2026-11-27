import { style, styleVariants } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { MonoOutput, MUTED_LIVE_OPACITY, Panel } from '../../ui/ThreadActivity.css';

const hairline = `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`;
const mono = { fontFamily: 'var(--font-mono)', fontSize: toRem(12) } as const;
const truncate = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;
const muted = { color: color.Surface.OnContainer, opacity: MUTED_LIVE_OPACITY } as const;

export const LIVE_OUTPUT_LINES = { subagent: 3, shell: 4 } as const;

export const Stack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  marginBlockStart: config.space.S100,
  minWidth: 0,
});

export const Card = style([
  Panel,
  {
    marginBlockStart: 0,
    color: color.Surface.OnContainer,
    minWidth: 0,
  },
]);

export const CardHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minWidth: 0,
  paddingBlock: toRem(6),
  paddingInline: toRem(10),
});

export const CardTitle = style({
  ...truncate,
  fontSize: toRem(12.5),
  fontWeight: config.fontWeight.W600,
  color: color.Surface.OnContainer,
});

export const CardCount = style({
  ...muted,
  flexShrink: 0,
  fontSize: toRem(12),
  whiteSpace: 'nowrap',
});

export const OpenButton = style([
  DefaultReset,
  muted,
  {
    marginInlineStart: 'auto',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: toRem(4),
    paddingBlock: toRem(2),
    paddingInline: toRem(6),
    border: 'none',
    borderRadius: config.radii.R300,
    background: 'none',
    font: 'inherit',
    fontSize: toRem(12),
    fontWeight: config.fontWeight.W500,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    selectors: {
      '&:focus-visible': {
        opacity: 1,
        outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
        outlineOffset: toRem(1),
      },
    },
    '@media': {
      '(pointer: coarse)': { minBlockSize: toRem(32) },
      '(hover: hover)': {
        selectors: {
          '&:hover': { opacity: 1, backgroundColor: color.SurfaceVariant.ContainerHover },
        },
      },
    },
  },
]);

export const Steps = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  selectors: { [`${CardHeader} + &`]: { borderTop: hairline } },
});

export const Step = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  selectors: { '& + &': { borderTop: hairline } },
});

export const StepRow = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: toRem(2),
  width: '100%',
  minWidth: 0,
  paddingBlock: toRem(6),
  paddingInline: toRem(10),
  color: color.Surface.OnContainer,
  fontSize: toRem(12),
  lineHeight: 1.4,
});

export const StepRowButton = style([
  DefaultReset,
  StepRow,
  {
    justifyContent: 'center',
    border: 'none',
    background: 'none',
    font: 'inherit',
    fontSize: toRem(12),
    lineHeight: 1.4,
    textAlign: 'start',
    cursor: 'pointer',
    selectors: {
      '&:focus-visible': {
        outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
        outlineOffset: toRem(-2),
        borderRadius: config.radii.R300,
      },
    },
    '@media': {
      '(pointer: coarse)': { minBlockSize: toRem(36) },
      '(hover: hover)': {
        selectors: { '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover } },
      },
    },
  },
]);

export const StepHead = style({
  display: 'flex',
  alignItems: 'center',
  gap: toRem(8),
  width: '100%',
  minWidth: 0,
});

const stepIconBase = style({
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
  inlineSize: toRem(16),
  blockSize: toRem(16),
});

export const StepIcon = styleVariants({
  running: [stepIconBase, { color: color.Primary.Main }],
  waiting: [stepIconBase, { color: color.Warning.Main }],
  done: [stepIconBase, { color: color.Success.Main }],
  failed: [stepIconBase, { color: color.Warning.Main }],
});

const stepNameBase = style({
  ...mono,
  ...truncate,
  flex: '0 1 auto',
  marginInlineEnd: 'auto',
  color: color.Surface.OnContainer,
});

export const StepName = styleVariants({
  active: [stepNameBase, { fontWeight: config.fontWeight.W600 }],
  done: [stepNameBase, muted, { fontWeight: config.fontWeight.W500 }],
  failed: [stepNameBase, { fontWeight: config.fontWeight.W500 }],
});

// Indented in interface direction past StepIcon (16px) + StepHead gap (8px) so an LTR command
// inside an RTL interface still aligns under StepName.
export const StepArgWrap = style({
  display: 'block',
  minWidth: 0,
  paddingInlineStart: toRem(24),
});

export const StepArg = style({
  ...mono,
  ...muted,
  display: '-webkit-box',
  minWidth: 0,
  overflow: 'hidden',
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
});

export const StepElapsed = style({
  ...muted,
  flexShrink: 0,
  fontSize: toRem(11.5),
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
});

export const StepChevron = style({
  flexShrink: 0,
  color: color.Surface.OnContainer,
  opacity: config.opacity.P400,
  selectors: {
    '[dir=rtl] &': { transform: 'rotate(180deg)' },
    [`${StepRowButton}[aria-expanded="true"] &`]: { transform: 'rotate(90deg)' },
  },
  '@media': {
    '(prefers-reduced-motion: no-preference)': { transition: 'transform 150ms ease' },
  },
});

const TERMINAL_LINE_HEIGHT = 1.45;

// Outer padded well so bottom-aligned inner output never clips into or bleeds across the padding.
export const TerminalWell = style({
  paddingBlock: toRem(6),
  paddingInline: toRem(10),
  borderTop: hairline,
  backgroundColor: `color-mix(in srgb, ${color.SurfaceVariant.Container} 45%, transparent)`,
  minWidth: 0,
});

const terminalOutputBase = style([
  MonoOutput,
  muted,
  {
    fontSize: toRem(11.5),
    lineHeight: TERMINAL_LINE_HEIGHT,
  },
]);

// Bounds wrapped output to exact rendered line counts, keeping the newest wrapped lines at bottom.
export const TerminalOutput = styleVariants(LIVE_OUTPUT_LINES, (lines) => [
  terminalOutputBase,
  { maxHeight: `${TERMINAL_LINE_HEIGHT * lines}em` },
]);

export const Drawer = style([
  TerminalWell,
  { display: 'flex', flexDirection: 'column', gap: toRem(6) },
]);

export const DrawerHead = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minWidth: 0,
});

export const DrawerLabel = style({
  ...muted,
  fontSize: toRem(11),
  fontWeight: config.fontWeight.W600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
});

export const CopyButton = style([
  OpenButton,
  { border: hairline, fontSize: toRem(11.5), lineHeight: 1.3 },
]);

export const DrawerCode = style([
  DefaultReset,
  mono,
  {
    margin: 0,
    color: color.Surface.OnContainer,
    lineHeight: TERMINAL_LINE_HEIGHT,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    userSelect: 'text',
  },
]);

export const DrawerDivider = style({
  borderTop: `${config.borderWidth.B300} dashed ${color.SurfaceVariant.ContainerLine}`,
});

export const DrawerOutput = style([
  terminalOutputBase,
  { display: 'block', maxHeight: '16em', overflowX: 'hidden', overflowY: 'auto', userSelect: 'text' },
]);

// Warning.OnContainer on an 8% Warning.Main tint keeps >= 5.08:1 contrast across all 23 palettes.
export const DrawerResult = styleVariants({
  done: [DrawerOutput],
  failed: [
    DrawerOutput,
    {
      color: color.Warning.OnContainer,
      opacity: 1,
      paddingBlock: toRem(4),
      paddingInline: toRem(6),
      borderRadius: config.radii.R300,
      backgroundColor: `color-mix(in srgb, ${color.Warning.Main} 8%, transparent)`,
    },
  ],
});
