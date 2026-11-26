import { style, styleVariants } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

const hairline = `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`;
const mono = { fontFamily: 'var(--font-mono)', fontSize: toRem(12) } as const;
const truncate = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;
const muted = { color: color.Surface.OnContainer, opacity: config.opacity.P400 } as const;

export const Stack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  marginBlockStart: config.space.S100,
  minWidth: 0,
});

export const Card = style({
  border: hairline,
  borderRadius: config.radii.R400,
  backgroundColor: `color-mix(in srgb, ${color.SurfaceVariant.Container} 60%, transparent)`,
  color: color.Surface.OnContainer,
  overflow: 'hidden',
  minWidth: 0,
});

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
  done: [stepIconBase, { color: color.Success.Main }],
  failed: [stepIconBase, { color: color.Warning.Main }],
});

const stepNameBase = style({
  ...mono,
  flexShrink: 0,
  color: color.Surface.OnContainer,
  whiteSpace: 'nowrap',
});

export const StepName = styleVariants({
  running: [stepNameBase, { fontWeight: config.fontWeight.W600 }],
  done: [stepNameBase, { fontWeight: config.fontWeight.W500, opacity: config.opacity.P400 }],
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

export const TerminalWell = style([
  DefaultReset,
  {
    margin: 0,
    paddingBlock: toRem(6),
    paddingInline: toRem(10),
    borderTop: hairline,
    backgroundColor: `color-mix(in srgb, ${color.SurfaceVariant.Container} 45%, transparent)`,
    color: color.Surface.OnContainer,
    fontFamily: 'var(--font-mono)',
    fontSize: toRem(11.5),
    lineHeight: 1.45,
    opacity: 0.88,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    overflow: 'hidden',
  },
]);
