import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { motion } from '../../ui/styles/Motion.css';
import { transition } from '../../ui/styles/transition';

const CONTROL_HEIGHT = toRem(32);
const FOCUS_RING = { outline: `${toRem(2)} solid ${color.Primary.Main}`, outlineOffset: toRem(1) };
const HOVER_BG = {
  '@media': {
    '(hover: hover)': {
      selectors: { '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover } },
    },
  },
} as const;

export const PageBody = style({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minBlockSize: 0,
  minInlineSize: 0,
  overflow: 'hidden',
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

export const RoomFilterBar = style({
  display: 'flex',
  alignItems: 'center',
  columnGap: config.space.S200,
  paddingBlockStart: config.space.S200,
  paddingBlockEnd: config.space.S100,
  paddingInline: config.space.S300,
  minInlineSize: 0,
  flexShrink: 0,
  position: 'relative',
  zIndex: 2,
});

export const RoomChipStrip = style({
  display: 'flex',
  alignItems: 'center',
  columnGap: config.space.S100,
  flex: '1 1 auto',
  minInlineSize: 0,
  overflowX: 'auto',
  overflowY: 'hidden',
  scrollbarWidth: 'none',
  selectors: { '&::-webkit-scrollbar': { display: 'none' } },
});

export const RoomChipGroup = style({
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  blockSize: CONTROL_HEIGHT,
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
  transition: transition(['background-color', 'border-color'], motion.duration.Normal),
});

export const RoomChipGroupActive = style({
  backgroundColor: color.Primary.Container,
  borderColor: color.Primary.ContainerLine,
  color: color.Primary.OnContainer,
});

export const RoomChipButton = style([
  DefaultReset,
  HOVER_BG,
  {
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: config.space.S100,
    blockSize: '100%',
    paddingInline: config.space.S200,
    borderRadius: config.radii.R400,
    color: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    minInlineSize: 0,
    selectors: { '&:focus-visible': FOCUS_RING },
  },
]);

export const RoomChipName = style({
  maxInlineSize: '11rem',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const RoomChipCount = style({
  opacity: config.opacity.P400,
  fontVariantNumeric: 'tabular-nums',
});

export const RoomChipOnlyButton = style([
  DefaultReset,
  {
    display: 'inline-flex',
    alignItems: 'center',
    blockSize: '100%',
    paddingInline: config.space.S200,
    borderInlineStart: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
    color: 'inherit',
    opacity: config.opacity.P400,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontSize: toRem(12),
    borderRadius: config.radii.R300,
    '@media': {
      '(hover: hover)': {
        selectors: {
          '&:hover': { opacity: '1', backgroundColor: color.SurfaceVariant.ContainerHover },
        },
      },
    },
    selectors: { '&:focus-visible': { ...FOCUS_RING, opacity: '1' } },
  },
]);

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
