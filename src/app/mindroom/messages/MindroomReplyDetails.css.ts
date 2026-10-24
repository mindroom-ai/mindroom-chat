import { style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// Groups separate by space; only the cost card has a fill of its own.
export const Body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(18),
  padding: `${toRem(18)} ${config.space.S500} ${config.space.S500}`,
  width: `min(${toRem(384)}, calc(100vw - 2 * ${config.space.S400}))`,
  // Leaves room for the header so expanded technical details scroll instead of leaving the screen.
  maxHeight: `calc(100dvh - ${toRem(128)})`,
  overflowY: 'auto',
  boxSizing: 'border-box',
});

export const Lead = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S300,
  minWidth: 0,
});

export const Tile = style({
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  width: toRem(36),
  height: toRem(36),
  borderRadius: toRem(10),
  backgroundColor: color.SurfaceVariant.Container,
});

export const ModelName = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  flexGrow: 1,
});

// Provider-qualified model IDs can be long; they wrap instead of losing their version.
export const ModelSource = style({
  overflowWrap: 'anywhere',
});

const statusBase = style({
  flexShrink: 0,
  padding: `${toRem(1)} ${config.space.S200}`,
  borderRadius: config.radii.Pill,
  fontSize: toRem(12),
  fontWeight: config.fontWeight.W500,
  lineHeight: toRem(18),
});

export const Status = styleVariants({
  error: [
    statusBase,
    { backgroundColor: color.Critical.Container, color: color.Critical.OnContainer },
  ],
  cancelled: [
    statusBase,
    { backgroundColor: color.Warning.Container, color: color.Warning.OnContainer },
  ],
});

export const CostCard = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S300,
  padding: `${toRem(14)} ${config.space.S400}`,
  borderRadius: toRem(12),
  backgroundColor: color.Primary.Container,
  color: color.Primary.OnContainer,
});

export const CostFigures = styleVariants({
  one: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)' },
  two: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: config.space.S300,
  },
});

export const CostFigure = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  selectors: {
    '& + &': {
      borderInlineStart: `${config.borderWidth.B300} solid ${color.Primary.ContainerLine}`,
      paddingInlineStart: config.space.S300,
    },
  },
});

export const CostLabel = style({
  fontSize: toRem(12),
  lineHeight: toRem(16),
  opacity: 0.85,
});

export const CostValue = style({
  fontSize: toRem(22),
  fontWeight: 650,
  letterSpacing: '-0.02em',
  lineHeight: toRem(28),
  fontVariantNumeric: 'tabular-nums',
});

export const CostNote = style({
  fontSize: toRem(12),
  lineHeight: toRem(16),
  opacity: 0.8,
});

export const Bars = style({
  display: 'flex',
  alignItems: 'flex-end',
  gap: toRem(3),
  height: toRem(48),
  paddingBottom: toRem(4),
  borderBottom: `${config.borderWidth.B300} solid ${color.Primary.ContainerLine}`,
});

const barBase = style({
  flex: '1 1 0',
  minWidth: toRem(2),
  borderRadius: `${toRem(3)} ${toRem(3)} ${toRem(1)} ${toRem(1)}`,
});

// Earlier replies make up the total so far; later ones show what came after.
export const Bar = styleVariants({
  earlier: [
    barBase,
    { backgroundColor: `color-mix(in srgb, ${color.Primary.Main} 35%, transparent)` },
  ],
  current: [barBase, { backgroundColor: color.Primary.Main }],
  later: [barBase, { backgroundColor: color.Primary.ContainerLine }],
});

const axisBase = style({
  display: 'flex',
  gap: config.space.S200,
  marginTop: toRem(-6),
  fontSize: toRem(11.5),
  lineHeight: toRem(16),
  opacity: 0.8,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
});

// Unnumbered while older replies are not loaded, since their positions are unknown.
export const Axis = styleVariants({
  numbered: [axisBase, { justifyContent: 'space-between' }],
  unnumbered: [axisBase, { justifyContent: 'center' }],
});

export const Section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
});

export const SectionHeader = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: config.space.S300,
});

export const HeaderValue = style({
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'end',
});

export const Meter = style({
  display: 'flex',
  height: toRem(6),
  borderRadius: config.radii.Pill,
  overflow: 'hidden',
  backgroundColor: color.SurfaceVariant.Container,
});

const partColors = {
  cacheRead: color.Success.Main,
  newInput: color.Primary.Main,
  input: color.Primary.Main,
  output: color.Warning.Main,
};

export const Segment = styleVariants(partColors, (backgroundColor) => ({
  height: '100%',
  backgroundColor,
}));

export const Legend = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: `${toRem(4)} ${toRem(14)}`,
  margin: 0,
  padding: 0,
  listStyle: 'none',
});

export const LegendItem = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(6),
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
});

export const Swatch = styleVariants(partColors, (backgroundColor) => ({
  width: toRem(8),
  height: toRem(8),
  borderRadius: toRem(2),
  flexShrink: 0,
  backgroundColor,
}));

export const Meta = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: `${toRem(4)} ${config.space.S400}`,
  fontVariantNumeric: 'tabular-nums',
});

export const MetaValue = style({
  color: color.Surface.OnContainer,
  fontWeight: config.fontWeight.W600,
});

export const TechnicalSummary = style({
  cursor: 'pointer',
  width: 'fit-content',
  borderRadius: config.radii.R300,
  selectors: {
    '&:focus-visible': {
      outline: `${toRem(2)} solid ${color.Primary.Main}`,
      outlineOffset: toRem(2),
    },
  },
});

export const TechnicalRows = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  margin: `${config.space.S200} 0 0`,
});

// Identifiers are long, so each sits under its label instead of beside it.
export const Identifier = style({
  margin: `0 0 ${config.space.S200}`,
  fontFamily: 'var(--font-mono)',
  overflowWrap: 'anywhere',
});
