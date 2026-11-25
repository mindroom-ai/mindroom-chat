import { createContainer, globalStyle, style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import {
  Body as SubagentsBody,
  Empty,
  Panel,
  StatusDot,
  VisuallyHidden,
} from '../subagentsPanel.css';

const { space, radii, borderWidth, fontSize, lineHeight, opacity } = config;
const line = `${borderWidth.B300} solid ${color.Surface.ContainerLine}`;
const variantLine = `${borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`;
const focusRing = { outline: `2px solid ${color.Primary.Main}`, outlineOffset: 1 } as const;
const truncate = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
const smallType = { fontSize: fontSize.T200, lineHeight: lineHeight.T200 } as const;
const tabular = { fontVariantNumeric: 'tabular-nums' } as const;
const flexRow = { display: 'flex', alignItems: 'center' } as const;
const panelBody = createContainer();
const groupBox = createContainer();
const widePanel = `${panelBody} (min-width: 36rem)`;
const twoCols = `${groupBox} (min-width: 20rem)`;
const threeCols = `${groupBox} (min-width: 34rem)`;
const sessionRing = {
  borderColor: color.Primary.ContainerLine,
  boxShadow: `inset 0 0 0 1px ${color.Primary.ContainerLine}`,
} as const;
const surfaceCard = {
  border: line,
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
} as const;
const variantCard = {
  border: variantLine,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
} as const;
const surfacePressed = {
  borderColor: color.Primary.Main,
  backgroundColor: color.Surface.ContainerActive,
} as const;
const variantPressed = {
  borderColor: color.Primary.Main,
  backgroundColor: color.SurfaceVariant.ContainerActive,
} as const;

export { Empty, Panel, VisuallyHidden };

const dotBase = style({ flexShrink: 0, marginInlineEnd: 0 });
export const NodeDot = styleVariants({
  queued: [StatusDot.paused, dotBase],
  running: [StatusDot.running, dotBase],
  waiting: [StatusDot.awaiting_approval, dotBase],
  completed: [StatusDot.completed, dotBase],
  failed: [StatusDot.failed, dotBase],
  cancelled: [StatusDot.cancelled, dotBase],
  indeterminate: [StatusDot.awaiting_approval, dotBase],
});

const pill = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: space.S100,
  borderRadius: radii.Pill,
  ...smallType,
});

export const Stack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: space.S100,
  minInlineSize: 0,
});
export const StrongText = style({ margin: 0, fontWeight: 600 });
export const EndAlign = style({ marginInlineStart: 'auto' });
export const MutedNum = style({ ...smallType, ...tabular, flexShrink: 0, opacity: opacity.P400 });

export const Body = style([
  SubagentsBody,
  Stack,
  { containerName: panelBody, containerType: 'inline-size', gap: space.S300 },
]);
export const TabBar = style({
  ...flexRow,
  flex: 'none',
  gap: space.S100,
  paddingInline: space.S300,
  paddingBlock: space.S100,
  borderBlockEnd: line,
  overflowX: 'auto',
});
export const TabButton = style([
  pill,
  {
    flexShrink: 0,
    padding: `${space.S100} ${space.S200}`,
    border: `${borderWidth.B300} solid transparent`,
    backgroundColor: 'transparent',
    color: color.Surface.OnContainer,
    fontWeight: 500,
    cursor: 'pointer',
    selectors: {
      '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover },
      '&:focus-visible': focusRing,
      '&[aria-selected="true"]': {
        backgroundColor: color.Primary.Container,
        color: color.Primary.OnContainer,
        borderColor: color.Primary.ContainerLine,
        fontWeight: 600,
      },
    },
  },
]);
export const TabPanel = style([
  Stack,
  { gap: space.S300, borderRadius: radii.R300, selectors: { '&:focus-visible': focusRing } },
]);

export const StaleBanner = style({
  padding: `${space.S200} ${space.S300}`,
  borderRadius: radii.R300,
  backgroundColor: color.Warning.Container,
  color: color.Warning.OnContainer,
});
export const SplitLayout = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: space.S300,
  alignItems: 'start',
  '@container': { [widePanel]: { gridTemplateColumns: 'minmax(0, 1.18fr) minmax(0, 0.82fr)' } },
});
export const InsetBox = style([
  Stack,
  { gap: space.S200, padding: space.S200, borderRadius: radii.R400, ...variantCard },
]);
export const InspectorPane = style([
  InsetBox,
  {
    padding: space.S300,
    '@container': {
      [widePanel]: {
        position: 'sticky',
        insetBlockStart: 0,
        maxBlockSize: 'calc(100vh - 8rem)',
        overflowY: 'auto',
      },
    },
  },
]);
export const InspectorEmpty = style({
  display: 'none',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  paddingInline: space.S300,
  paddingBlock: space.S500,
  borderRadius: radii.R400,
  border: `${borderWidth.B300} dashed ${color.Surface.ContainerLine}`,
  color: color.Surface.OnContainer,
  '@container': { [widePanel]: { display: 'flex', position: 'sticky', insetBlockStart: 0 } },
});

export const KpiGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  borderRadius: radii.R300,
  overflow: 'hidden',
  ...tabular,
  ...surfaceCard,
});
export const KpiCell = style([
  Stack,
  {
    gap: toRem(2),
    padding: `${space.S100} ${space.S200}`,
    selectors: { '& + &': { borderInlineStart: line } },
  },
]);
export const KpiValue = style({ fontWeight: 600, ...truncate });
export const ErrorBox = style([
  Stack,
  {
    padding: space.S200,
    borderRadius: radii.R300,
    border: `${borderWidth.B300} solid ${color.Critical.ContainerLine}`,
    backgroundColor: color.Critical.Container,
    color: color.Critical.OnContainer,
    overflowWrap: 'anywhere',
    maxBlockSize: toRem(220),
    overflowY: 'auto',
  },
]);
export const ResultPre = style({
  margin: 0,
  padding: space.S200,
  borderRadius: radii.R300,
  fontFamily: 'var(--font-mono, monospace)',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  maxBlockSize: toRem(240),
  overflowY: 'auto',
  ...surfaceCard,
  ...smallType,
});
export const PeerLinkButton = style({
  ...flexRow,
  ...surfaceCard,
  ...smallType,
  inlineSize: '100%',
  padding: `${space.S100} ${space.S200}`,
  borderRadius: radii.R300,
  textAlign: 'start',
  cursor: 'pointer',
  selectors: {
    '&:hover': { backgroundColor: color.Surface.ContainerHover },
    '&:focus-visible': focusRing,
  },
});

export const GraphCanvas = style([Stack, { gap: 0 }]);
export const Band = style([Stack, { gap: space.S200 }]);
export const PhaseHeader = style({
  ...flexRow,
  gap: space.S200,
  selectors: { '&::after': { content: '""', flex: '1 1 0', borderBlockStart: line } },
});
export const PhaseHeading = style({
  margin: 0,
  fontWeight: 600,
  color: color.Surface.OnContainer,
  opacity: opacity.P400,
});
export const FlowConnector = style({
  display: 'flex',
  justifyContent: 'center',
  paddingBlock: toRem(2),
});
export const BandGap = style({ blockSize: space.S300 });
export const ForkJoinSvg = style({ display: 'block', inlineSize: '100%', blockSize: toRem(18) });
export const ConnectorPath = style({
  fill: 'none',
  stroke: color.SurfaceVariant.OnContainer,
  strokeOpacity: 0.65,
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});
export const ForkVis = styleVariants({
  one: { '@container': { [twoCols]: { display: 'none' } } },
  two: { display: 'none', '@container': { [twoCols]: { display: 'inline' } } },
  twoMid: {
    display: 'none',
    '@container': { [twoCols]: { display: 'inline' }, [threeCols]: { display: 'none' } },
  },
  three: { display: 'none', '@container': { [threeCols]: { display: 'inline' } } },
});

export const GroupBox = style([
  InsetBox,
  { gap: space.S100, containerName: groupBox, containerType: 'inline-size' },
]);
export const GroupHeader = style({ ...flexRow, flexWrap: 'wrap', gap: space.S200 });
export const ProgressTrack = style({
  inlineSize: '100%',
  blockSize: toRem(3),
  borderRadius: radii.Pill,
  backgroundColor: color.Surface.ContainerLine,
  overflow: 'hidden',
});
const progressBase = style({ blockSize: '100%', borderRadius: radii.Pill });
export const ProgressFill = styleVariants({
  live: [progressBase, { backgroundColor: color.Primary.Main }],
  done: [progressBase, { backgroundColor: color.Success.Main }],
  failed: [progressBase, { backgroundColor: color.Critical.Main }],
});

const branchBase = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: space.S200,
  alignItems: 'start',
});
const cols2 = { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' };
export const BranchGrid = styleVariants({
  one: [branchBase],
  two: [branchBase, { '@container': { [twoCols]: cols2 } }],
  many: [
    branchBase,
    {
      '@container': {
        [twoCols]: cols2,
        [threeCols]: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
      },
    },
  ],
});

export const CenterWrap = style({
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: space.S100,
});
export const CountBadge = style([
  pill,
  {
    ...surfaceCard,
    ...tabular,
    flexShrink: 0,
    paddingInline: space.S200,
    paddingBlock: toRem(2),
    fontWeight: 600,
  },
]);
export const PeerBridgePill = style([
  CountBadge,
  { border: `${borderWidth.B300} dashed ${color.Primary.ContainerLine}`, fontWeight: 400 },
]);

export const Chip = style([
  Stack,
  {
    inlineSize: '100%',
    padding: space.S200,
    textAlign: 'start',
    borderRadius: radii.R400,
    cursor: 'pointer',
    overflow: 'hidden',
    ...variantCard,
    selectors: {
      '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover },
      '&:focus-visible': focusRing,
      '&[data-session-highlighted="true"]': sessionRing,
      '&[aria-pressed="true"]': variantPressed,
      [`${GroupBox} &`]: surfaceCard,
      [`${GroupBox} &:hover`]: { backgroundColor: color.Surface.ContainerHover },
      [`${GroupBox} &[data-session-highlighted="true"]`]: sessionRing,
      [`${GroupBox} &[aria-pressed="true"]`]: surfacePressed,
    },
  },
]);
export const ChipTop = style({ ...flexRow, gap: space.S200, minInlineSize: 0 });
export const ChipLabel = style({
  fontWeight: 600,
  flex: '1 1 auto',
  minInlineSize: 0,
  ...truncate,
});
export const ChipMeta = style({
  ...flexRow,
  flexWrap: 'wrap',
  minInlineSize: 0,
  maxInlineSize: '100%',
  columnGap: space.S200,
  rowGap: toRem(2),
  color: 'inherit',
  opacity: opacity.P400,
  ...smallType,
});
globalStyle(`${ChipMeta} > span`, { minInlineSize: 0, maxInlineSize: '100%', ...truncate });
export const ChipNote = style({ ...smallType, color: color.Warning.Main });
const badgeText = style({ display: 'inline-block', minInlineSize: 0, ...smallType, ...truncate });
export const StepStatusNote = style([
  badgeText,
  { flexShrink: 0, maxInlineSize: toRem(140), opacity: opacity.P400 },
]);
export const SessionBadge = style([
  badgeText,
  {
    flexShrink: 0,
    maxInlineSize: toRem(120),
    paddingInline: space.S100,
    paddingBlock: toRem(1),
    borderRadius: radii.Pill,
    backgroundColor: color.Primary.Container,
    color: color.Primary.OnContainer,
  },
]);
export const ErrorPill = style([
  badgeText,
  {
    alignSelf: 'flex-start',
    maxInlineSize: '100%',
    paddingInline: space.S200,
    paddingBlock: toRem(2),
    borderRadius: radii.R300,
    backgroundColor: color.Critical.Container,
    color: color.Critical.OnContainer,
    fontWeight: 500,
  },
]);
export const PlumbingPill = style([
  pill,
  {
    ...surfaceCard,
    maxInlineSize: '100%',
    padding: `${space.S100} ${space.S200}`,
    border: `${borderWidth.B300} dashed ${color.SurfaceVariant.ContainerLine}`,
    cursor: 'pointer',
    selectors: {
      '&:hover': { backgroundColor: color.Surface.ContainerHover },
      '&:focus-visible': focusRing,
      '&[aria-pressed="true"]': { ...surfacePressed, borderStyle: 'solid' },
    },
  },
]);
export const IndentRail = style([
  Stack,
  {
    gap: toRem(2),
    paddingInlineStart: space.S300,
    marginInlineStart: space.S100,
    borderInlineStart: `2px solid ${color.Surface.ContainerLine}`,
  },
]);
export const StepRow = style({
  ...flexRow,
  gap: space.S200,
  inlineSize: '100%',
  padding: `${space.S100} ${space.S200}`,
  borderRadius: radii.R300,
  border: `${borderWidth.B300} solid transparent`,
  backgroundColor: 'transparent',
  color: color.Surface.OnContainer,
  textAlign: 'start',
  cursor: 'pointer',
  ...smallType,
  selectors: {
    '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover },
    '&:focus-visible': focusRing,
    '&[data-session-highlighted="true"]': { borderColor: color.Primary.ContainerLine },
    '&[aria-pressed="true"]': {
      borderColor: color.Primary.Main,
      backgroundColor: color.SurfaceVariant.ContainerActive,
    },
  },
});
export const MessageList = style([Stack, { margin: 0, padding: 0, listStyle: 'none' }]);
export const MessageRow = style({
  ...flexRow,
  justifyContent: 'space-between',
  gap: space.S200,
  padding: `${space.S200} ${space.S300}`,
  borderRadius: radii.R300,
  ...variantCard,
  ...smallType,
});
export const LogList = style([
  InsetBox,
  {
    margin: 0,
    listStyle: 'none',
    gap: space.S100,
    fontFamily: 'var(--font-mono, monospace)',
    overflowWrap: 'anywhere',
    ...smallType,
  },
]);
