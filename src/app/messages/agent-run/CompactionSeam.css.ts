import { globalStyle, keyframes, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { motion } from '../../ui/styles/Motion.css';
import { transition } from '../../ui/styles/transition';

const slide = keyframes({
  from: { backgroundPosition: '200% 0' },
  to: { backgroundPosition: '0 0' },
});
const pulse = keyframes({ '50%': { opacity: 0.35 } });
const squeeze = keyframes({ '50%': { transform: 'scaleY(0.6)' } });

const stillUnderReducedMotion = {
  '(prefers-reduced-motion: reduce)': { animation: 'none' },
};

const UNFINISHED = ['failed', 'timeout', 'interrupted'];

/** `scope` with each state a compaction ended in without a summary, around `inner`. */
const unfinished = (scope: string, inner = '') =>
  UNFINISHED.map((state) => `${scope}[data-state="${state}"]${inner}`).join(', ');

// One quiet row at the spot of the reply where the history was compacted, with a hairline to the
// row's end: muted at rest like the AI title marker, colored while it runs or when it failed.
export const Seam = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  marginBlock: toRem(6),
  minWidth: 0,
});

export const Trigger = style([
  DefaultReset,
  {
    display: 'inline-flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: `0 ${toRem(5)}`,
    minWidth: 0,
    border: 0,
    borderRadius: config.radii.R300,
    paddingBlock: toRem(1),
    paddingInline: toRem(6),
    marginInlineStart: toRem(-6),
    background: 'transparent',
    color: color.Surface.OnContainer,
    // folds' muted text level, which keeps 12px text above WCAG AA contrast.
    opacity: config.opacity.P300,
    font: 'inherit',
    fontSize: toRem(12),
    lineHeight: toRem(20),
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'start',
    cursor: 'pointer',
    transition: transition(['opacity', 'color', 'background-color'], motion.duration.Fast),
    selectors: {
      '&:hover, &:focus-visible, &[aria-expanded="true"]': {
        opacity: 1,
        color: color.Primary.Main,
        background: color.Primary.Container,
      },
      [`${Seam}[data-state="running"] &`]: { opacity: 1, color: color.Primary.Main },
      [unfinished(Seam, ' &')]: { opacity: 1, color: color.Warning.Main },
      [`${unfinished(Seam, ' &:hover')}, ${unfinished(Seam, ' &[aria-expanded="true"]')}`]: {
        color: color.Warning.OnContainer,
        background: color.Warning.Container,
      },
      '&:focus-visible': {
        outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
        outlineOffset: toRem(1),
      },
    },
  },
]);

export const Icon = style({
  flex: 'none',
  selectors: {
    [`${Seam}[data-state="running"] &`]: {
      animation: `${squeeze} 1.1s ease-in-out infinite`,
      '@media': stillUnderReducedMotion,
    },
  },
});

export const Separator = style({ opacity: 0.7 });

// A plain line at rest, a light running along it while the summary is written, and an amber
// dashed one when the reply kept its full history.
export const Rule = style({
  flex: 1,
  minWidth: toRem(16),
  blockSize: toRem(1),
  background: color.Surface.ContainerLine,
  selectors: {
    [`${Seam}[data-state="running"] &`]: {
      background: `linear-gradient(90deg, ${color.Surface.ContainerLine} 0%, ${color.Primary.Main} 50%, ${color.Surface.ContainerLine} 100%)`,
      backgroundSize: '200% 100%',
      animation: `${slide} 1.4s linear infinite`,
      '@media': stillUnderReducedMotion,
    },
    [unfinished(Seam, ' &')]: {
      blockSize: 0,
      background: 'none',
      borderBlockStart: `${toRem(1)} dashed ${color.Warning.Main}`,
      opacity: 0.6,
    },
  },
});

export const Card = style({
  inlineSize: toRem(336),
  maxInlineSize: `calc(100vw - ${toRem(16)})`,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  borderRadius: config.radii.R400,
  paddingBlock: toRem(12),
  paddingInline: toRem(14),
  background: color.Surface.Container,
  color: color.Surface.OnContainer,
  boxShadow: config.shadow.E400,
  fontSize: toRem(12),
  lineHeight: toRem(18),
  fontWeight: 400,
  textAlign: 'start',
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
});

export const Head = style({
  display: 'flex',
  alignItems: 'center',
  gap: toRem(6),
  fontSize: toRem(13),
  fontWeight: 600,
  selectors: {
    [`${Card}[data-state="running"] &`]: { color: color.Primary.Main },
    [unfinished(Card, ' &')]: { color: color.Warning.Main },
  },
});

export const Tag = style({
  marginInlineStart: 'auto',
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.Pill,
  paddingInline: toRem(7),
  background: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  fontSize: toRem(11),
  fontWeight: 500,
  whiteSpace: 'nowrap',
});

const muted = { opacity: config.opacity.P400 };

export const Subtitle = style({ ...muted, marginBlock: `${toRem(2)} ${toRem(8)}` });

// The context gauge: the track is the history budget, the hatched bar the history before the
// compaction, the solid one after it.
export const Gauge = style({
  position: 'relative',
  display: 'block',
  blockSize: toRem(6),
  marginBlockStart: toRem(8),
  borderRadius: config.radii.Pill,
  background: color.SurfaceVariant.Container,
  overflow: 'hidden',
  selectors: {
    '&[data-over="true"]::after': {
      content: '""',
      position: 'absolute',
      insetBlock: 0,
      insetInlineEnd: 0,
      inlineSize: toRem(3),
      background: color.Warning.Main,
    },
  },
});

const bar = {
  position: 'absolute',
  insetBlock: 0,
  insetInlineStart: 0,
  borderRadius: config.radii.Pill,
} as const;

export const GaugeWas = style({
  ...bar,
  background: `repeating-linear-gradient(135deg, ${color.Surface.OnContainer} 0 ${toRem(
    3
  )}, transparent ${toRem(3)} ${toRem(6)})`,
  opacity: 0.35,
  selectors: {
    [`${Gauge}[data-state="running"] &`]: {
      animation: `${pulse} 1.2s ease-in-out infinite`,
      '@media': stillUnderReducedMotion,
    },
    [unfinished(Gauge, ' &')]: { background: color.Warning.Main, opacity: 0.8 },
  },
});

export const GaugeNow = style({ ...bar, background: color.Primary.Main });

export const GaugeLabel = style({
  ...muted,
  display: 'flex',
  justifyContent: 'space-between',
  gap: toRem(8),
  marginBlock: `${toRem(3)} ${toRem(8)}`,
  fontSize: toRem(11),
});

export const Rows = style({
  display: 'grid',
  gridTemplateColumns: 'max-content minmax(0, 1fr)',
  gap: `${toRem(3)} ${toRem(14)}`,
  marginBlock: `${toRem(8)} 0`,
  marginInline: 0,
});

export const Term = style(muted);

export const Value = style({ margin: 0, fontVariantNumeric: 'tabular-nums' });

// A failure reason is error text of any length; past six lines it would push the card off a
// phone, which cannot scroll it.
export const Reason = style({
  display: '-webkit-box',
  WebkitLineClamp: 6,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

globalStyle(`${Value} b`, { fontWeight: 600 });
