import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const focusRing = { outline: `2px solid ${color.Primary.Main}`, outlineOffset: '2px' };
const cardBase = {
  display: 'flex' as const,
  flexDirection: 'column' as const,
  padding: config.space.S400,
  borderRadius: config.radii.R400,
  backgroundColor: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  minInlineSize: 0,
};
const rowBetween = {
  display: 'flex' as const,
  alignItems: 'center' as const,
  justifyContent: 'space-between' as const,
  flexWrap: 'wrap' as const,
};

export const HeaderInner = style({
  ...rowBetween,
  gap: config.space.S200,
  inlineSize: '100%',
  minInlineSize: 0,
});
export const HeaderTitle = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minInlineSize: 0,
});
export const HeaderControls = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: config.space.S200,
});
export const Toolbar = style({
  ...rowBetween,
  gap: config.space.S300,
  marginBlockEnd: config.space.S400,
});

export const Segmented = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(2),
  padding: toRem(3),
  borderRadius: config.radii.R400,
  backgroundColor: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const SegmentTab = style({
  border: 'none',
  background: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  font: 'inherit',
  fontSize: config.fontSize.T200,
  fontWeight: config.fontWeight.W500,
  paddingBlock: config.space.S100,
  paddingInline: config.space.S300,
  borderRadius: config.radii.R300,
  cursor: 'pointer',
  selectors: {
    '&[aria-selected="true"]': {
      backgroundColor: color.Surface.Container,
      color: color.Surface.OnContainer,
      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.12)',
    },
    '&:hover:not([aria-selected="true"])': { backgroundColor: color.SurfaceVariant.ContainerHover },
    '&:focus-visible': focusRing,
  },
});

export const RuntimeSelect = style({
  font: 'inherit',
  fontSize: config.fontSize.T200,
  color: color.Surface.OnContainer,
  backgroundColor: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
  paddingBlock: config.space.S100,
  paddingInline: config.space.S200,
  maxInlineSize: toRem(240),
  selectors: { '&:focus-visible': focusRing },
});

export const RefreshButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.Surface.OnContainer,
  font: 'inherit',
  fontSize: config.fontSize.T200,
  fontWeight: config.fontWeight.W500,
  paddingBlock: config.space.S100,
  paddingInline: config.space.S300,
  borderRadius: config.radii.R300,
  cursor: 'pointer',
  selectors: {
    '&:hover:not(:disabled)': { backgroundColor: color.SurfaceVariant.ContainerHover },
    '&:disabled': { opacity: config.opacity.Disabled, cursor: 'default' },
    '&:focus-visible': focusRing,
  },
});

export const MutedText = style({
  fontSize: config.fontSize.T200,
  color: color.Surface.OnContainer,
  opacity: config.opacity.P400,
});

export const PartialNotice = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  marginBlockEnd: config.space.S400,
  borderRadius: config.radii.R300,
  backgroundColor: color.Warning.Container,
  color: color.Warning.OnContainer,
  fontSize: config.fontSize.T200,
});

export const CardGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: config.space.S400,
  selectors: { '&[data-mobile="true"]': { gridTemplateColumns: 'minmax(0, 1fr)' } },
  '@media': { '(max-width: 44rem)': { gridTemplateColumns: 'minmax(0, 1fr)' } },
});

export const AccountCard = style({
  ...cardBase,
  gap: config.space.S400,
  selectors: { '&[data-span-full="true"]': { gridColumn: '1 / -1' } },
});

export const CardHeader = style({
  ...rowBetween,
  flexWrap: 'nowrap',
  gap: config.space.S200,
  minInlineSize: 0,
});
export const CardIdentity = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minInlineSize: 0,
});
export const ProviderDot = style({
  inlineSize: toRem(8),
  blockSize: toRem(8),
  borderRadius: config.radii.Pill,
  flexShrink: 0,
});
export const CardTitles = style({ display: 'flex', flexDirection: 'column', minInlineSize: 0 });

export const CardName = style({
  fontSize: config.fontSize.T400,
  fontWeight: config.fontWeight.W600,
  color: color.Surface.OnContainer,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const WindowsList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S300,
  flexGrow: 1,
});

export const NoLimitNote = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  padding: config.space.S300,
  borderRadius: config.radii.R300,
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  fontSize: config.fontSize.T200,
});

export const CardFooter = style({
  ...rowBetween,
  gap: config.space.S200,
  paddingBlockStart: config.space.S200,
  borderBlockStart: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  fontSize: config.fontSize.T200,
  fontVariantNumeric: 'tabular-nums',
  color: color.Surface.OnContainer,
  opacity: config.opacity.P400,
});

export const SummaryRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: config.space.S400,
  marginBlockEnd: config.space.S400,
});
export const MetricCard = style({ ...cardBase, flex: '1 1 12rem', gap: config.space.S100 });
export const MetricValue = style({
  fontSize: config.fontSize.H3,
  fontWeight: config.fontWeight.W600,
  fontVariantNumeric: 'tabular-nums',
  color: color.Surface.OnContainer,
});
export const SectionCard = style({
  ...cardBase,
  gap: config.space.S300,
  marginBlockEnd: config.space.S400,
});

export const ChartBars = style({
  display: 'grid',
  gridAutoFlow: 'column',
  gridAutoColumns: 'minmax(0, 1fr)',
  alignItems: 'end',
  gap: config.space.S200,
  blockSize: toRem(160),
  paddingBlockStart: config.space.S200,
});

export const DayColumn = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: config.space.S100,
  blockSize: '100%',
  minInlineSize: 0,
});

export const BarTrack = style({
  flexGrow: 1,
  inlineSize: '100%',
  maxInlineSize: toRem(36),
  display: 'flex',
  flexDirection: 'column-reverse',
  justifyContent: 'flex-start',
  borderRadius: config.radii.R300,
  overflow: 'hidden',
  backgroundColor: color.Surface.Container,
});

export const BarSegment = style({ inlineSize: '100%', minBlockSize: toRem(2) });
export const DayLabel = style({
  fontSize: config.fontSize.T200,
  color: color.Surface.OnContainer,
  opacity: config.opacity.P400,
  whiteSpace: 'nowrap',
});
export const Legend = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: config.space.S300,
  fontSize: config.fontSize.T200,
  color: color.Surface.OnContainer,
});
export const LegendItem = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
});
export const TableWrap = style({ inlineSize: '100%', overflowX: 'auto' });
export const Table = style({
  inlineSize: '100%',
  borderCollapse: 'collapse',
  fontVariantNumeric: 'tabular-nums',
});

globalStyle(`${Table} th, ${Table} td`, {
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  textAlign: 'start',
  borderBlockEnd: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  fontSize: config.fontSize.T300,
});
globalStyle(`${Table} th`, {
  fontSize: config.fontSize.T200,
  fontWeight: config.fontWeight.W500,
  opacity: config.opacity.P400,
  whiteSpace: 'nowrap',
});
globalStyle(`${Table} tbody tr:last-child td`, { borderBlockEnd: 'none' });

export const NumericCell = style({ textAlign: 'end', whiteSpace: 'nowrap' });
export const CenterState = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: config.space.S300,
  paddingBlock: config.space.S700,
  paddingInline: config.space.S400,
  textAlign: 'center',
});
