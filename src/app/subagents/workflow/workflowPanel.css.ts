import { style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { Panel as SidePanelPanel } from '../../ui/panels/SidePanel.css';

const { space, radii, borderWidth } = config;
const quietLine = `${borderWidth.B300} solid ${color.Surface.ContainerLine}`;

export const Panel = style([SidePanelPanel, { flexGrow: 1, position: 'relative' }]);

export const HeaderMain = style({
  display: 'flex',
  flexDirection: 'column',
  gap: space.S100,
  flex: '1 1 auto',
  minInlineSize: 0,
});

export const HeaderTitleRow = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: space.S100,
  minInlineSize: 0,
});

export const HeaderMeta = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: space.S200,
  rowGap: space.S100,
});

export const HeaderActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: space.S100,
  flexShrink: 0,
});

export const Body = style({
  flex: '1 1 auto',
  minBlockSize: 0,
  overflowY: 'auto',
  padding: space.S300,
  display: 'flex',
  flexDirection: 'column',
  gap: space.S300,
});

export const Empty = style({
  display: 'block',
  paddingBlock: space.S400,
  textAlign: 'center',
});

export const StaleBanner = style({
  paddingInline: space.S300,
  paddingBlock: space.S200,
  borderRadius: radii.R300,
  backgroundColor: color.Warning.Container,
  color: color.Warning.OnContainer,
});

export const GraphCanvas = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: space.S300,
});

export const EdgeOverlay = style({
  position: 'absolute',
  inset: 0,
  inlineSize: '100%',
  blockSize: '100%',
  pointerEvents: 'none',
  overflow: 'visible',
  zIndex: 3,
});

export const EdgePath = style({
  fill: 'none',
  stroke: color.Primary.Main,
  strokeWidth: 1.5,
  strokeOpacity: 0.65,
});

export const Band = style({
  position: 'relative',
  zIndex: 2,
  display: 'flex',
  flexDirection: 'column',
  gap: space.S200,
});

export const BandHeading = style({
  margin: 0,
  fontWeight: 600,
});

export const ItemsGrid = style({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fill, minmax(${toRem(220)}, 1fr))`,
  gap: space.S200,
  alignItems: 'start',
});

export const GroupBox = style({
  gridColumn: '1 / -1',
  display: 'flex',
  flexDirection: 'column',
  gap: space.S200,
  padding: space.S200,
  borderRadius: radii.R400,
  border: quietLine,
  backgroundColor: color.SurfaceVariant.Container,
});

export const GroupHeader = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: space.S200,
  justifyContent: 'space-between',
});

export const GroupProgressTrack = style({
  blockSize: toRem(4),
  inlineSize: '100%',
  borderRadius: radii.Pill,
  backgroundColor: color.Surface.ContainerLine,
  overflow: 'hidden',
});

export const GroupProgressFill = style({
  blockSize: '100%',
  backgroundColor: color.Primary.Main,
  borderRadius: radii.Pill,
});

export const GroupFailed = style({
  color: color.Critical.Main,
  fontWeight: 500,
});

export const ChipStack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: space.S100,
  minInlineSize: 0,
});

export const Chip = style({
  display: 'flex',
  flexDirection: 'column',
  gap: space.S100,
  inlineSize: '100%',
  minInlineSize: 0,
  padding: space.S200,
  textAlign: 'start',
  borderRadius: radii.R400,
  border: quietLine,
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      backgroundColor: color.Surface.ContainerHover,
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: 1,
    },
    '&[aria-pressed="true"]': {
      borderColor: color.Primary.Main,
      backgroundColor: color.Surface.ContainerActive,
    },
  },
});

export const ChipTop = style({
  display: 'flex',
  alignItems: 'center',
  gap: space.S200,
  minInlineSize: 0,
});

export const ChipLabel = style({
  fontWeight: 600,
  flex: '1 1 auto',
  minInlineSize: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const ChipMeta = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: space.S200,
  rowGap: toRem(2),
  fontSize: config.fontSize.T200,
  lineHeight: config.lineHeight.T200,
  color: color.Surface.OnContainer,
  opacity: config.opacity.P400,
});

export const ChipNote = style({
  fontSize: config.fontSize.T200,
  lineHeight: config.lineHeight.T200,
  color: color.Warning.Main,
});

const dotBase = style({
  inlineSize: toRem(8),
  blockSize: toRem(8),
  borderRadius: radii.Pill,
  flexShrink: 0,
});

export const NodeDot = styleVariants({
  queued: [dotBase, { backgroundColor: color.Surface.ContainerLine }],
  running: [dotBase, { backgroundColor: color.Primary.Main }],
  waiting: [dotBase, { backgroundColor: color.Warning.Main }],
  completed: [dotBase, { backgroundColor: color.Success.Main }],
  failed: [dotBase, { backgroundColor: color.Critical.Main }],
  cancelled: [dotBase, { backgroundColor: color.Surface.ContainerLine }],
  indeterminate: [dotBase, { backgroundColor: color.Warning.Main }],
});

export const SessionTurns = style({
  display: 'flex',
  flexDirection: 'column',
  gap: space.S100,
  paddingInlineStart: space.S300,
  borderInlineStart: `2px solid ${color.Surface.ContainerLine}`,
});

export const DetailsCard = style({
  display: 'flex',
  flexDirection: 'column',
  gap: space.S200,
  padding: space.S300,
  borderRadius: radii.R400,
  border: quietLine,
  backgroundColor: color.SurfaceVariant.Container,
});

export const DetailsActions = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: space.S200,
});

export const DetailsBlock = style({
  display: 'flex',
  flexDirection: 'column',
  gap: toRem(2),
});

export const DetailsError = style({
  color: color.Critical.Main,
  overflowWrap: 'anywhere',
});

export const OmittedSection = style({
  display: 'flex',
  flexDirection: 'column',
  gap: space.S100,
  padding: space.S200,
  borderRadius: radii.R300,
  backgroundColor: color.SurfaceVariant.Container,
});

export const LogSection = style({
  display: 'flex',
  flexDirection: 'column',
  gap: space.S100,
});

export const LogList = style({
  margin: 0,
  padding: space.S200,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: space.S100,
  borderRadius: radii.R300,
  backgroundColor: color.SurfaceVariant.Container,
  fontFamily: 'monospace',
  fontSize: config.fontSize.T200,
  overflowWrap: 'anywhere',
});
