import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const PageBody = style({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minBlockSize: 0,
  minInlineSize: 0,
  overflow: 'hidden',
});

export const OverviewSlot = style({
  flexShrink: 0,
  position: 'relative',
  zIndex: 5,
});

export const HeaderBadge = style({
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  paddingBlock: toRem(2),
  paddingInline: config.space.S200,
  borderRadius: config.radii.Pill,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
});

export const RoomChipName = style({
  maxInlineSize: '11rem',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const RoomDot = style({
  display: 'inline-block',
  inlineSize: '0.5rem',
  blockSize: '0.5rem',
  borderRadius: config.radii.Pill,
  flexShrink: 0,
});

export const ThreadListScroll = style({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minBlockSize: 0,
  minInlineSize: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  paddingBlockStart: config.space.S100,
  paddingBlockEnd: config.space.S400,
  paddingInline: config.space.S300,
  rowGap: config.space.S200,
  isolation: 'isolate',
});

export const RoomBadge = style({
  display: 'inline-flex',
  alignItems: 'center',
  columnGap: toRem(4),
  paddingBlock: toRem(1),
  paddingInline: config.space.S200,
  borderRadius: config.radii.Pill,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.Surface.Container,
  color: color.SurfaceVariant.OnContainer,
  maxInlineSize: '10rem',
  fontSize: toRem(11),
  lineHeight: 1.3,
  flexShrink: 0,
});

export const RoomBadgeName = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

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

export const ComposerDraftNote = style({
  display: 'inline-flex',
  alignItems: 'center',
  paddingBlock: toRem(2),
  paddingInline: config.space.S200,
  borderRadius: config.radii.Pill,
  backgroundColor: color.Warning.Container,
  color: color.Warning.OnContainer,
  marginInlineStart: 'auto',
  whiteSpace: 'nowrap',
});

export const ReadOnlyNotice = style({
  paddingBlock: config.space.S200,
  paddingInline: config.space.S400,
  textAlign: 'center',
  color: color.SurfaceVariant.OnContainer,
  opacity: config.opacity.P400,
});
