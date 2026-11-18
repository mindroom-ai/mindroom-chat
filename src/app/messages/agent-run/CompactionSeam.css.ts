import { globalStyle, keyframes, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
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

// The trigger hovered, focused from the keyboard or with its card open.
const ACTIVE = ':is(:hover, :focus-visible, [aria-expanded="true"])';

/** `scope` with each state a compaction ended in without a summary, around `inner`. */
const unfinished = (scope: string, inner = '') =>
  UNFINISHED.map((state) => `${scope}[data-state="${state}"]${inner}`).join(', ');

// One quiet row at the spot of the reply where the history was compacted, with a hairline to the
// row's end: its words in the reply's text color, its icon and rule colored while it runs or when
// it failed.
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
    // The reply's text color and, from it, its opacity, so the label reads as its text does. A
    // state's color goes on the icon, the rule and the highlight, never on the words.
    color: 'inherit',
    font: 'inherit',
    fontSize: toRem(12),
    lineHeight: toRem(20),
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'start',
    cursor: 'pointer',
    transition: transition(['background-color']),
    selectors: {
      [`&${ACTIVE}`]: { background: color.Primary.Container },
      [unfinished(Seam, ` &${ACTIVE}`)]: { background: color.Warning.Container },
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
      color: color.Primary.Main,
      animation: `${squeeze} 1.1s ease-in-out infinite`,
      '@media': stillUnderReducedMotion,
    },
    [unfinished(Seam, ' &')]: { color: color.Warning.Main },
  },
});

export const Separator = style({ opacity: 0.7 });

// A plain line at rest, a light running along it while the summary is written, and an amber
// dashed one when the compaction did not finish.
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
  // Never taller than the window, as the message menu: the rest scrolls inside.
  maxBlockSize: 'min(80dvh, calc(100dvh - 24px))',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
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

// A tag that does not fit beside the title moves to its own line, so the title keeps the width.
export const Head = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: toRem(6),
  fontSize: toRem(13),
  fontWeight: 600,
});

/** The head's icon, in the state's color, as the row's is. */
export const HeadIcon = style({
  flex: 'none',
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
  // A long translated label wraps at half the card, so its value always keeps width.
  gridTemplateColumns: 'fit-content(50%) minmax(0, 1fr)',
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
