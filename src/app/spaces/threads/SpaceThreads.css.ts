import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

const FlexColumn = style({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minBlockSize: 0,
  minInlineSize: 0,
});

const PillBase = style({
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  borderRadius: config.radii.Pill,
  paddingInline: config.space.S200,
});

const OutlinedPill = style([
  PillBase,
  {
    border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
    color: color.SurfaceVariant.OnContainer,
  },
]);

export const PageBody = style([FlexColumn, { overflow: 'hidden' }]);

export const OverviewSlot = style({
  flexShrink: 0,
  position: 'relative',
  zIndex: 5,
});

export const HeaderBadge = style([
  OutlinedPill,
  {
    paddingBlock: toRem(2),
    backgroundColor: color.SurfaceVariant.Container,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
]);

export const RoomBadgeName = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const RoomChipName = style([RoomBadgeName, { maxInlineSize: '11rem' }]);

export const RoomDot = style({
  display: 'inline-block',
  inlineSize: '0.5rem',
  blockSize: '0.5rem',
  borderRadius: config.radii.Pill,
  flexShrink: 0,
});

export const ThreadListScroll = style([
  FlexColumn,
  {
    overflowY: 'auto',
    overflowX: 'hidden',
    paddingBlockStart: config.space.S100,
    paddingBlockEnd: config.space.S400,
    paddingInline: config.space.S300,
    isolation: 'isolate',
  },
]);

export const ThreadListContent = style({
  display: 'flex',
  flexDirection: 'column',
  rowGap: config.space.S200,
  flexShrink: 0,
  minInlineSize: 0,
});

export const RoomBadge = style([
  OutlinedPill,
  {
    columnGap: toRem(4),
    paddingBlock: toRem(1),
    backgroundColor: color.Surface.Container,
    maxInlineSize: '10rem',
    fontSize: toRem(11),
    lineHeight: 1.3,
  },
]);

export const ComposerDock = style({
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  rowGap: config.space.S100,
  paddingBlockStart: config.space.S200,
  paddingBlockEnd: config.space.S300,
  borderBlockStart: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  backgroundColor: color.Surface.Container,
});

export const ComposerTargetBar = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  columnGap: config.space.S100,
  rowGap: config.space.S100,
  paddingInline: config.space.S400,
  minInlineSize: 0,
});

export const ComposerDraftNote = style([
  PillBase,
  {
    paddingBlock: toRem(2),
    backgroundColor: color.Warning.Container,
    color: color.Warning.OnContainer,
    marginInlineStart: 'auto',
    whiteSpace: 'nowrap',
  },
]);

export const ReadOnlyNotice = style({
  paddingBlock: config.space.S200,
  paddingInline: config.space.S400,
  textAlign: 'center',
  color: color.SurfaceVariant.OnContainer,
  opacity: config.opacity.P400,
});
