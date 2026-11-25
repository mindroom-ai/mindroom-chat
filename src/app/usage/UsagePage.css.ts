import { globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const focusRing = { outline: `${toRem(2)} solid ${color.Primary.Main}`, outlineOffset: toRem(2) };
const insetFocusRing = {
  outline: `${toRem(2)} solid ${color.Primary.Main}`,
  outlineOffset: toRem(-2),
};
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
const border = `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`;
const card = {
  display: 'flex' as const,
  flexDirection: 'column' as const,
  padding: config.space.S400,
  borderRadius: config.radii.R400,
  backgroundColor: color.SurfaceVariant.Container,
  border,
  minInlineSize: 0,
};
const rowBetween = {
  display: 'flex' as const,
  alignItems: 'center' as const,
  justifyContent: 'space-between' as const,
  flexWrap: 'wrap' as const,
  gap: config.space.S200,
  minInlineSize: 0,
};
const truncate = {
  overflow: 'hidden' as const,
  textOverflow: 'ellipsis' as const,
  whiteSpace: 'nowrap' as const,
};
const pill = {
  display: 'inline-flex' as const,
  alignItems: 'center' as const,
  fontSize: toRem(11),
  lineHeight: 1.4,
  paddingBlock: toRem(1),
  paddingInline: toRem(7),
  border,
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  whiteSpace: 'nowrap' as const,
};

export const UsageHeader = style({
  blockSize: 'auto',
  minBlockSize: toRem(54),
  paddingBlock: config.space.S200,
});
export const HeaderInner = style({ ...rowBetween, inlineSize: '100%' });
export const RowBetween = style(rowBetween);
export const RowInline = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  minInlineSize: 0,
});
export const RowWrap = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: config.space.S200,
  minInlineSize: 0,
});
export const PageStack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S400,
  inlineSize: '100%',
  maxInlineSize: toRem(960),
  marginInline: 'auto',
  minInlineSize: 0,
});
export const MutedText = style({
  fontSize: config.fontSize.T200,
  color: color.Surface.OnContainer,
  opacity: config.opacity.P400,
});
export const ColorDot = style({
  inlineSize: toRem(8),
  blockSize: toRem(8),
  borderRadius: config.radii.Pill,
  flexShrink: 0,
  display: 'inline-block',
});

export const RuntimeSelect = style({
  font: 'inherit',
  fontSize: config.fontSize.T200,
  color: color.Surface.OnContainer,
  backgroundColor: color.SurfaceVariant.Container,
  border,
  borderRadius: config.radii.R300,
  paddingBlock: config.space.S100,
  paddingInline: config.space.S200,
  maxInlineSize: toRem(220),
  selectors: { '&:focus-visible': focusRing },
});

export const ActionButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  border,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.Surface.OnContainer,
  font: 'inherit',
  fontSize: config.fontSize.T200,
  fontWeight: config.fontWeight.W500,
  paddingBlock: config.space.S100,
  paddingInline: config.space.S300,
  borderRadius: config.radii.R300,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  selectors: {
    '&:hover:not(:disabled)': { backgroundColor: color.SurfaceVariant.ContainerHover },
    '&:disabled': { opacity: config.opacity.Disabled, cursor: 'default' },
    '&[aria-pressed="true"]': {
      borderColor: color.Primary.Main,
      color: color.Primary.Main,
      backgroundColor: color.Primary.Container,
    },
    '&:focus-visible': focusRing,
  },
});

export const PartialNotice = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  borderRadius: config.radii.R300,
  backgroundColor: color.Warning.Container,
  color: color.Warning.OnContainer,
  fontSize: config.fontSize.T200,
});

export const PillBadge = style({
  ...pill,
  borderRadius: config.radii.Pill,
  fontWeight: config.fontWeight.W600,
  fontVariantNumeric: 'tabular-nums',
  selectors: {
    '&[data-tone="ok"]': {
      color: color.Success.Main,
      borderColor: color.Success.ContainerLine,
      backgroundColor: color.Success.Container,
    },
    '&[data-tone="warn"]': {
      color: color.Warning.Main,
      borderColor: color.Warning.ContainerLine,
      backgroundColor: color.Warning.Container,
    },
  },
});

export const KpiGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: config.space.S300,
  selectors: { '&[data-single="true"]': { gridTemplateColumns: 'minmax(0, 1fr)' } },
});
export const KpiCard = style({ ...card, padding: config.space.S300, gap: config.space.S100 });
export const KpiValue = style({
  fontSize: config.fontSize.H3,
  fontWeight: config.fontWeight.W700,
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '-0.02em',
  color: color.Surface.OnContainer,
  ...truncate,
});

export const SectionCard = style({ ...card, gap: config.space.S300 });
export const MixCard = style({ ...card, paddingBlock: config.space.S300, gap: config.space.S200 });
export const SectionHeading = style({
  margin: 0,
  fontSize: config.fontSize.T300,
  fontWeight: config.fontWeight.W600,
  color: color.Surface.OnContainer,
});
export const SectionKicker = style({
  ...rowBetween,
  paddingInline: toRem(2),
  marginBlockEnd: config.space.S200,
});
export const KickerTitle = style({
  margin: 0,
  fontSize: toRem(11),
  fontWeight: config.fontWeight.W600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: color.Surface.OnContainer,
  opacity: config.opacity.P400,
});

export const MixBar = style({
  display: 'flex',
  gap: toRem(2),
  blockSize: toRem(9),
  inlineSize: '100%',
  borderRadius: config.radii.Pill,
  overflow: 'hidden',
  backgroundColor: color.Surface.Container,
  selectors: { '&[data-compact="true"]': { blockSize: toRem(6) } },
});
export const MixSegment = style({
  blockSize: '100%',
  borderRadius: toRem(3),
  minInlineSize: toRem(2),
});
export const MixLegend = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: `${config.space.S100} ${config.space.S300}`,
  fontSize: config.fontSize.T200,
  fontVariantNumeric: 'tabular-nums',
});

export const CardGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: config.space.S300,
  selectors: { '&[data-mobile="true"]': { gridTemplateColumns: 'minmax(0, 1fr)' } },
  '@media': { '(max-width: 44rem)': { gridTemplateColumns: 'minmax(0, 1fr)' } },
});
export const AccountCard = style({
  ...card,
  gap: config.space.S300,
  selectors: { '&[data-span-full="true"]': { gridColumn: '1 / -1' } },
});
export const CardHeader = style({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: config.space.S200,
  minInlineSize: 0,
});
export const CardName = style({
  fontSize: config.fontSize.T400,
  fontWeight: config.fontWeight.W600,
  color: color.Surface.OnContainer,
  ...truncate,
});
export const CardStats = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  flexShrink: 0,
  fontSize: config.fontSize.T200,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'end',
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
export const ChipFooter = style({
  marginBlockStart: 'auto',
  paddingBlockStart: config.space.S200,
  borderBlockStart: border,
});
export const ChipRow = style({ display: 'flex', flexWrap: 'wrap', gap: toRem(4) });
export const ModelChip = style({
  ...pill,
  borderRadius: config.radii.R300,
  opacity: config.opacity.P500,
  fontFamily: MONO,
  maxInlineSize: '100%',
  ...truncate,
});

export const Segmented = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(2),
  padding: toRem(2),
  borderRadius: config.radii.R300,
  backgroundColor: color.Surface.Container,
  border,
  maxInlineSize: '100%',
});
export const SegmentTab = style({
  border: 'none',
  background: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  font: 'inherit',
  fontSize: config.fontSize.T200,
  fontWeight: config.fontWeight.W500,
  paddingBlock: toRem(4),
  paddingInline: toRem(9),
  borderRadius: config.radii.R300,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  selectors: {
    '&[aria-selected="true"]': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
      color: color.Surface.OnContainer,
      fontWeight: config.fontWeight.W600,
    },
    '&[aria-pressed="true"]': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
      color: color.Surface.OnContainer,
      fontWeight: config.fontWeight.W600,
    },
    '&:hover:not([aria-selected="true"]):not([aria-pressed="true"])': {
      backgroundColor: color.SurfaceVariant.Container,
    },
    '&:focus-visible': focusRing,
  },
});

export const ChartPlot = style({
  display: 'grid',
  gridTemplateColumns: `${toRem(42)} minmax(0, 1fr)`,
  gap: config.space.S100,
  alignItems: 'stretch',
});
export const ChartYAxis = style({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  paddingBlock: `${toRem(16)} ${toRem(20)}`,
  fontSize: toRem(10),
  fontVariantNumeric: 'tabular-nums',
  color: color.Surface.OnContainer,
  opacity: config.opacity.P400,
  textAlign: 'end',
});
export const ChartBars = style({
  display: 'grid',
  gridAutoFlow: 'column',
  gridAutoColumns: 'minmax(0, 1fr)',
  gap: config.space.S100,
  blockSize: toRem(152),
  alignItems: 'end',
  backgroundImage: `linear-gradient(to bottom, ${color.SurfaceVariant.ContainerLine} 1px, transparent 1px)`,
  backgroundSize: '100% 33.33%',
});
export const ChartDayButton = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: toRem(4),
  blockSize: '100%',
  minInlineSize: 0,
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
  selectors: { '&:focus-visible': focusRing },
});
export const ChartTopVal = style({
  fontSize: toRem(10),
  lineHeight: toRem(14),
  blockSize: toRem(14),
  fontVariantNumeric: 'tabular-nums',
  color: color.Surface.OnContainer,
  opacity: config.opacity.P400,
  maxInlineSize: '100%',
  ...truncate,
  selectors: {
    '&[data-selected="true"]': {
      color: color.Primary.Main,
      opacity: 1,
      fontWeight: config.fontWeight.W700,
    },
  },
});
export const ChartBarTrack = style({
  flexGrow: 1,
  inlineSize: '100%',
  maxInlineSize: toRem(34),
  display: 'flex',
  flexDirection: 'column-reverse',
  justifyContent: 'flex-start',
  borderStartStartRadius: config.radii.R300,
  borderStartEndRadius: config.radii.R300,
  borderEndStartRadius: toRem(4),
  borderEndEndRadius: toRem(4),
  overflow: 'hidden',
  backgroundColor: color.Surface.Container,
  outline: `${toRem(2)} solid transparent`,
  transition: 'outline-color 140ms ease, transform 140ms ease',
  selectors: {
    '&[data-selected="true"]': {
      outlineColor: color.Primary.Main,
      transform: `translateY(${toRem(-2)})`,
    },
  },
});
export const ChartBarSegment = style({ inlineSize: '100%', minBlockSize: toRem(2) });
export const ChartDayLabel = style({
  fontSize: toRem(11),
  color: color.Surface.OnContainer,
  opacity: config.opacity.P400,
  maxInlineSize: '100%',
  ...truncate,
  selectors: { '&[data-selected="true"]': { opacity: 1, fontWeight: config.fontWeight.W600 } },
});

export const DayDetail = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  borderRadius: config.radii.R300,
  backgroundColor: color.Surface.Container,
  border: `${config.borderWidth.B300} solid ${color.Primary.ContainerLine}`,
  fontSize: config.fontSize.T200,
  fontVariantNumeric: 'tabular-nums',
});
export const DayDetailCost = style({
  fontSize: config.fontSize.T300,
  fontWeight: config.fontWeight.W700,
  color: color.Primary.Main,
});
export const DayTable = style({
  inlineSize: '100%',
  borderCollapse: 'collapse',
  fontSize: config.fontSize.T200,
  fontVariantNumeric: 'tabular-nums',
});
globalStyle(`${DayTable} td`, {
  paddingBlock: toRem(4),
  borderBlockStart: `${config.borderWidth.B300} dashed ${color.SurfaceVariant.ContainerLine}`,
});
globalStyle(`${DayTable} tr:first-child td`, { borderBlockStart: 'none' });
export const DayNameCell = style({ paddingInline: 0 });
export const NumericCell = style({
  textAlign: 'end',
  whiteSpace: 'nowrap',
  paddingInlineStart: config.space.S300,
  paddingInlineEnd: 0,
});

export const RankList = style({ display: 'flex', flexDirection: 'column', gap: toRem(6) });
export const RankCard = style({
  border,
  borderRadius: config.radii.R300,
  backgroundColor: color.Surface.Container,
  overflow: 'hidden',
});
export const RankButton = style({
  inlineSize: '100%',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  cursor: 'pointer',
  textAlign: 'start',
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(6),
  selectors: {
    '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover },
    '&:focus-visible': insetFocusRing,
  },
});
export const RankRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S200,
  inlineSize: '100%',
  minInlineSize: 0,
  fontVariantNumeric: 'tabular-nums',
});
export const RankTitleWrap = style({ minInlineSize: 0, ...truncate });
export const RankTitle = style({
  fontSize: config.fontSize.T300,
  fontWeight: config.fontWeight.W600,
  color: color.Surface.OnContainer,
  selectors: { '&[data-mono="true"]': { fontFamily: MONO, fontSize: config.fontSize.T200 } },
});
export const RankMetrics = style({
  flexShrink: 0,
  fontSize: config.fontSize.T200,
  whiteSpace: 'nowrap',
});
export const ShareTrack = style({
  blockSize: toRem(4),
  inlineSize: '100%',
  borderRadius: config.radii.Pill,
  backgroundColor: color.SurfaceVariant.ContainerHover,
  overflow: 'hidden',
});
export const ShareFill = style({
  display: 'block',
  blockSize: '100%',
  borderRadius: config.radii.Pill,
});
export const RankDrawer = style({
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  borderBlockStart: border,
  backgroundColor: color.SurfaceVariant.Container,
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  fontSize: config.fontSize.T200,
  fontVariantNumeric: 'tabular-nums',
});

export const IdleToggle = style({
  inlineSize: '100%',
  border: `${config.borderWidth.B300} dashed ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
  background: 'transparent',
  color: color.Surface.OnContainer,
  opacity: config.opacity.P400,
  font: 'inherit',
  fontSize: config.fontSize.T200,
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S200,
  selectors: {
    '&:hover': { opacity: 1, backgroundColor: color.Surface.Container },
    '&:focus-visible': focusRing,
  },
});
export const IdleRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S200,
  paddingBlock: toRem(6),
  paddingInline: config.space.S300,
  fontSize: config.fontSize.T200,
  opacity: config.opacity.P400,
});
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
