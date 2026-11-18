import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const muted = `color-mix(in srgb, ${color.SurfaceVariant.OnContainer} 62%, transparent)`;
const line = `color-mix(in srgb, ${color.SurfaceVariant.ContainerLine} 70%, transparent)`;
const mix = (a: string, share: number, b: string) => `color-mix(in oklab, ${a} ${share}%, ${b})`;

/** The series colors, in order: the plot, the legend and the tooltip use them alike. */
export const SERIES_COLORS = [
  color.Primary.Main,
  mix(color.Primary.Main, 35, color.Success.Main),
  color.Warning.Main,
  color.Success.Main,
  mix(color.Primary.Main, 50, color.Critical.Main),
  color.Critical.Main,
  mix(color.Warning.Main, 50, color.Success.Main),
  mix(color.SurfaceVariant.OnContainer, 55, color.SurfaceVariant.Container),
];

/** The question card's frame (variant B); the one place the card's look is decided. */
export const Card = style({
  position: 'relative',
  boxSizing: 'border-box',
  width: '100%',
  maxWidth: toRem(640),
  minWidth: 0,
  marginBlock: config.space.S200,
  marginInline: 0,
  paddingBlock: toRem(12),
  paddingInline: toRem(14),
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: toRem(12),
  backgroundColor: `color-mix(in srgb, ${color.SurfaceVariant.Container} 60%, transparent)`,
  color: color.SurfaceVariant.OnContainer,
  overflowWrap: 'anywhere',
  whiteSpace: 'normal',
  // Caption and toggle share the first row; everything else spans it.
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  columnGap: toRem(10),
  alignItems: 'start',
});

globalStyle(`${Card} > *`, { gridColumn: '1 / -1' });

export const Heading = style({ gridColumn: 1, minWidth: 0 });

export const Title = style({ fontSize: toRem(14.5), fontWeight: 600, lineHeight: 1.35 });

export const Subtitle = style({ fontSize: toRem(12.5), lineHeight: 1.4, color: muted });

export const Toggle = style({
  gridColumn: 2,
  display: 'inline-flex',
  flexShrink: 0,
  padding: toRem(2),
  borderRadius: toRem(8),
  backgroundColor: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const ToggleButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(5),
  paddingBlock: toRem(1),
  paddingInline: toRem(8),
  border: 0,
  borderRadius: toRem(6),
  background: 'none',
  color: muted,
  font: 'inherit',
  fontSize: toRem(12.5),
  fontWeight: 500,
  lineHeight: toRem(20),
  cursor: 'pointer',
  selectors: {
    '&[aria-pressed="true"]': {
      backgroundColor: color.Surface.Container,
      color: color.Surface.OnContainer,
      boxShadow: `0 1px 2px ${color.Other.Shadow}`,
    },
    '&:focus-visible': { outline: `2px solid ${color.Other.FocusRing}` },
  },
});

export const ToggleIcon = style({ width: toRem(13), height: toRem(13), flexShrink: 0 });

export const Legend = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: `${toRem(4)} ${toRem(14)}`,
  margin: 0,
  marginBlockStart: toRem(8),
  padding: 0,
  listStyle: 'none',
  fontSize: toRem(12.5),
});

export const LegendItem = style({ display: 'flex', alignItems: 'center', gap: toRem(6) });

export const LegendValue = style({
  marginInlineStart: 'auto',
  paddingInlineStart: toRem(14),
  color: muted,
  fontVariantNumeric: 'tabular-nums',
});

export const Swatch = style({
  width: toRem(10),
  height: toRem(10),
  flexShrink: 0,
  borderRadius: toRem(3),
});

export const Plot = style({
  position: 'relative',
  marginBlockStart: toRem(8),
  borderRadius: toRem(6),
  outline: 'none',
  selectors: { '&:focus-visible': { boxShadow: `0 0 0 2px ${color.Other.FocusRing}` } },
});

export const Svg = style({ display: 'block', overflow: 'visible' });

globalStyle(`${Svg} text`, {
  fontFamily: 'inherit',
  fontSize: toRem(11.5),
  fill: muted,
  fontVariantNumeric: 'tabular-nums',
});

export const Grid = style({ stroke: line, strokeWidth: 1 });

export const Baseline = style({ stroke: color.SurfaceVariant.ContainerLine, strokeWidth: 1 });

export const Band = style({
  fill: `color-mix(in srgb, ${color.SurfaceVariant.ContainerActive} 70%, transparent)`,
});

export const SeriesLine = style({
  fill: 'none',
  strokeWidth: 2.2,
  strokeLinejoin: 'round',
  strokeLinecap: 'round',
});

export const Point = style({ stroke: color.Surface.Container, strokeWidth: 2 });

export const Donut = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: toRem(20),
});

export const DonutLegend = style([Legend, { flexDirection: 'column', gap: toRem(6), margin: 0 }]);

export const DonutCenter = style({ fontSize: toRem(18), fontWeight: 650 });

globalStyle(`${Svg} text${DonutCenter}`, {
  fontSize: toRem(18),
  fill: color.SurfaceVariant.OnContainer,
});

export const Tooltip = style({
  position: 'absolute',
  insetBlockStart: 0,
  zIndex: 1,
  minWidth: toRem(110),
  paddingBlock: toRem(6),
  paddingInline: toRem(9),
  borderRadius: toRem(8),
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  boxShadow: `0 4px 14px ${color.Other.Shadow}`,
  fontSize: toRem(12.5),
  lineHeight: 1.45,
  pointerEvents: 'none',
});

export const TooltipLabel = style({
  display: 'block',
  fontWeight: 600,
  marginBlockEnd: toRem(2),
});

export const TooltipRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: toRem(6),
  whiteSpace: 'nowrap',
});

export const TooltipValue = style({
  marginInlineStart: 'auto',
  paddingInlineStart: toRem(12),
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
});

export const TableScroll = style({ marginBlockStart: toRem(8), overflowX: 'auto' });

export const Table = style({
  borderCollapse: 'collapse',
  fontSize: toRem(14),
  fontVariantNumeric: 'tabular-nums',
});

globalStyle(`${Table} th, ${Table} td`, {
  paddingBlock: toRem(7),
  paddingInline: toRem(12),
  borderBlockEnd: `1px solid ${line}`,
  textAlign: 'start',
});

globalStyle(`${Table} thead th`, {
  fontWeight: 600,
  borderBlockEndColor: color.SurfaceVariant.ContainerLine,
});

globalStyle(`${Table} tbody th`, { fontWeight: 400 });

globalStyle(`${Table} td, ${Table} thead th + th`, { textAlign: 'end' });

globalStyle(`${Table} tr:last-child > *`, { borderBlockEnd: 0 });

globalStyle(`${Table} :is(th, td) + :is(th, td)`, { borderInlineStart: `1px solid ${line}` });

export const VisuallyHidden = style({
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
});
