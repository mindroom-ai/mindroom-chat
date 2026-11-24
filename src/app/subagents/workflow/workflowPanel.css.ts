import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { Body, Empty, Panel, StatusDot } from '../subagentsPanel.css';

const { space, radii, borderWidth } = config;
const line = `${borderWidth.B300} solid ${color.Surface.ContainerLine}`;

export { Body, Empty, Panel };

export const NodeDot = {
  queued: StatusDot.paused,
  running: StatusDot.running,
  waiting: StatusDot.awaiting_approval,
  completed: StatusDot.completed,
  failed: StatusDot.failed,
  cancelled: StatusDot.cancelled,
  indeterminate: StatusDot.awaiting_approval,
} as const;

export const Column = style({
  display: 'flex',
  flexDirection: 'column',
  gap: space.S100,
  minInlineSize: 0,
});
export const HeaderMain = style([Column, { flex: '1 1 auto' }]);
export const HeaderActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: space.S100,
  flexShrink: 0,
});
export const StrongText = style({ margin: 0, fontWeight: 600 });

export const StaleBanner = style({
  paddingInline: space.S300,
  paddingBlock: space.S200,
  borderRadius: radii.R300,
  backgroundColor: color.Warning.Container,
  color: color.Warning.OnContainer,
});

export const GraphCanvas = style([Column, { position: 'relative', gap: space.S300 }]);
export const Band = style([Column, { position: 'relative', zIndex: 2, gap: space.S200 }]);

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

export const ItemsGrid = style({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fill, minmax(${toRem(220)}, 1fr))`,
  gap: space.S200,
  alignItems: 'start',
});

export const InsetBox = style([
  Column,
  {
    gap: space.S200,
    padding: space.S200,
    borderRadius: radii.R400,
    border: line,
    backgroundColor: color.SurfaceVariant.Container,
  },
]);
export const GroupBox = style([InsetBox, { gridColumn: '1 / -1' }]);

export const ProgressTrack = style({
  blockSize: toRem(4),
  inlineSize: '100%',
  borderRadius: radii.Pill,
  backgroundColor: color.Surface.ContainerLine,
  overflow: 'hidden',
});
export const ProgressFill = style({
  blockSize: '100%',
  backgroundColor: color.Primary.Main,
  borderRadius: radii.Pill,
});

export const Chip = style([
  Column,
  {
    inlineSize: '100%',
    padding: space.S200,
    textAlign: 'start',
    borderRadius: radii.R400,
    border: line,
    backgroundColor: color.Surface.Container,
    color: color.Surface.OnContainer,
    cursor: 'pointer',
    selectors: {
      '&:hover': { backgroundColor: color.Surface.ContainerHover },
      '&:focus-visible': { outline: `2px solid ${color.Primary.Main}`, outlineOffset: 1 },
      '&[aria-pressed="true"]': {
        borderColor: color.Primary.Main,
        backgroundColor: color.Surface.ContainerActive,
      },
    },
  },
]);

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
export const NestedChildren = style([
  Column,
  { paddingInlineStart: space.S300, borderInlineStart: `2px solid ${color.Surface.ContainerLine}` },
]);
export const LogList = style([
  InsetBox,
  {
    margin: 0,
    listStyle: 'none',
    gap: space.S100,
    fontFamily: 'monospace',
    fontSize: config.fontSize.T200,
    overflowWrap: 'anywhere',
  },
]);
