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
  alignItems: 'center',
  gap: toRem(8),
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
  color: color.Surface.OnContainer,
});

export const StepName = styleVariants({
  active: [stepNameBase, { fontWeight: config.fontWeight.W600 }],
  done: [stepNameBase, muted, { fontWeight: config.fontWeight.W500 }],
  failed: [stepNameBase, { fontWeight: config.fontWeight.W500 }],
});

export const StepArg = style({ ...mono, ...truncate, ...muted, flex: '1 1 0px' });

export const StepElapsed = style({
  ...muted,
  marginInlineStart: 'auto',
  flexShrink: 0,
  fontSize: toRem(11.5),
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
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
