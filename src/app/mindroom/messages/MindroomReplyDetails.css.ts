import { style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// Groups separate by space alone; the dialog's surface owns the glass.
export const Body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S500,
  padding: config.space.S400,
  width: `min(${toRem(384)}, calc(100vw - 2 * ${config.space.S400}))`,
  // Leaves room for the header so expanded technical details scroll instead of leaving the screen.
  maxHeight: `calc(100dvh - ${toRem(128)})`,
  overflowY: 'auto',
  boxSizing: 'border-box',
});

export const Lead = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minWidth: 0,
});

export const ModelName = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  flexGrow: 1,
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

export const Section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
});

export const Rows = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: `${config.space.S100} ${config.space.S400}`,
  margin: 0,
});

// Figures align on the right edge so digits line up down the column.
export const Value = style({
  margin: 0,
  textAlign: 'end',
  fontVariantNumeric: 'tabular-nums',
});

// Identifiers are long, so each sits under its label instead of beside it.
export const Identifier = style({
  margin: `0 0 ${config.space.S200}`,
  fontFamily: 'var(--font-mono)',
  overflowWrap: 'anywhere',
});

// The bar's track is the unused part of the window.
export const ContextBar = style({
  display: 'flex',
  width: '100%',
  height: toRem(8),
  borderRadius: config.radii.Pill,
  overflow: 'hidden',
  backgroundColor: color.SurfaceVariant.Container,
});

const segmentColors = {
  cacheRead: color.Success.Main,
  newInput: color.Primary.Main,
};

export const ContextBarSegment = styleVariants(segmentColors, (backgroundColor) => ({
  height: '100%',
  backgroundColor,
}));

export const Legend = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: `${config.space.S100} ${config.space.S400}`,
  margin: 0,
  padding: 0,
  listStyle: 'none',
});

export const LegendItem = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  fontVariantNumeric: 'tabular-nums',
});

export const Swatch = styleVariants(segmentColors, (backgroundColor) => ({
  width: toRem(8),
  height: toRem(8),
  borderRadius: toRem(2),
  flexShrink: 0,
  backgroundColor,
}));

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
