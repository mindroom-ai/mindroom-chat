import { globalStyle, style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';
import { motion } from '../../ui/styles/Motion.css';
import { transition } from '../../ui/styles/transition';
import {
  COMPACT_COLLAPSED_RAIL_WIDTH_PX,
  COMPACT_COLUMN_GAP_PX,
  COMPACT_OPEN_COLUMN_BASIS_PX,
  COMPACT_OPEN_COLUMN_MIN_WIDTH_PX,
  COMPACT_SINGLE_OPEN_COLUMN_MAX_WIDTH_PX,
} from './compactColumnsLayout';

const focusRing = {
  outline: `2px solid ${color.Primary.Main}`,
  outlineOffset: '-2px',
};

const hoverSurface = {
  '@media': {
    '(hover: hover)': {
      selectors: { '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover } },
    },
  },
};

export const Board = style({
  display: 'flex',
  flex: '1 1 auto',
  alignItems: 'stretch',
  gap: toRem(COMPACT_COLUMN_GAP_PX),
  minBlockSize: 0,
  minInlineSize: 0,
  blockSize: '100%',
  inlineSize: '100%',
  overflowX: 'auto',
  overflowY: 'hidden',
  position: 'relative',
});

export const Column = style({
  display: 'flex',
  flexDirection: 'column',
  flex: `1 1 ${toRem(COMPACT_OPEN_COLUMN_BASIS_PX)}`,
  minInlineSize: toRem(COMPACT_OPEN_COLUMN_MIN_WIDTH_PX),
  minBlockSize: 0,
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: `color-mix(in srgb, ${color.SurfaceVariant.Container} 45%, transparent)`,
  color: color.SurfaceVariant.OnContainer,
  position: 'relative',
  overflow: 'hidden',
  transition: transition(
    ['border-color', 'background-color', 'box-shadow'],
    motion.duration.Normal
  ),
  selectors: {
    '&[data-dragging="true"]': {
      zIndex: 10,
      borderColor: color.Primary.ContainerLine,
      backgroundColor: color.SurfaceVariant.Container,
      boxShadow: `0 ${toRem(10)} ${toRem(28)} color-mix(in srgb, currentColor 18%, transparent)`,
    },
  },
});

export const ColumnCollapsed = style({
  flex: `0 0 ${toRem(COMPACT_COLLAPSED_RAIL_WIDTH_PX)}`,
  inlineSize: toRem(COMPACT_COLLAPSED_RAIL_WIDTH_PX),
  minInlineSize: toRem(COMPACT_COLLAPSED_RAIL_WIDTH_PX),
  maxInlineSize: toRem(COMPACT_COLLAPSED_RAIL_WIDTH_PX),
  backgroundColor: color.SurfaceVariant.Container,
});

// Cap a lone open column so cards never stretch across an ultra-wide void.
globalStyle(`${Board}[data-open-count="1"] ${Column}:not(${ColumnCollapsed})`, {
  maxInlineSize: toRem(COMPACT_SINGLE_OPEN_COLUMN_MAX_WIDTH_PX),
});

// The surface, unlike the button, remounts on fold so only hover transitions its fill.
export const ColumnTriggerSurface = style({
  position: 'absolute',
  inset: 0,
  zIndex: -1,
  pointerEvents: 'none',
  transition: transition(['background-color'], motion.duration.Normal),
});

const ColumnTriggerBase = style([
  DefaultReset,
  {
    display: 'flex',
    position: 'relative',
    isolation: 'isolate',
    alignItems: 'center',
    inlineSize: '100%',
    paddingBlock: config.space.S200,
    color: color.SurfaceVariant.OnContainer,
    cursor: 'grab',
    userSelect: 'none',
    backgroundColor: 'transparent',
    selectors: { '&:focus-visible': focusRing, '&:active': { cursor: 'grabbing' } },
  },
]);

export const ColumnHeader = style([
  ColumnTriggerBase,
  {
    gap: config.space.S100,
    flexShrink: 0,
    minInlineSize: 0,
    paddingInline: config.space.S200,
    borderBlockEnd: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
    textAlign: 'start',
  },
]);

export const ColumnRail = style([
  ColumnTriggerBase,
  {
    flexDirection: 'column',
    gap: config.space.S200,
    flex: '1 1 auto',
    blockSize: '100%',
    minBlockSize: 0,
    paddingInline: 0,
  },
]);

globalStyle(`${ColumnHeader} ${ColumnTriggerSurface}`, {
  backgroundColor: color.SurfaceVariant.Container,
});
globalStyle(
  `${ColumnHeader}:hover ${ColumnTriggerSurface}, ${ColumnRail}:hover ${ColumnTriggerSurface}`,
  { '@media': { '(hover: hover)': { backgroundColor: color.SurfaceVariant.ContainerHover } } }
);

globalStyle(
  `${Column}[data-dragging="true"] ${ColumnHeader}, ${Column}[data-dragging="true"] ${ColumnRail}`,
  { cursor: 'grabbing' }
);

// Only the grip claims touch gestures (`touch-action: none`) so touch tablets keep native board panning.
export const DragGrip = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  padding: config.space.S100,
  margin: `calc(-1 * ${config.space.S100})`,
  touchAction: 'none',
  opacity: config.opacity.P300,
  transition: transition(['opacity'], motion.duration.Fast),
});

globalStyle(
  `${ColumnHeader}:hover ${DragGrip}, ${ColumnHeader}:focus-visible ${DragGrip}, ${ColumnRail}:hover ${DragGrip}, ${ColumnRail}:focus-visible ${DragGrip}`,
  { opacity: config.opacity.P500 }
);

export const HeaderLabel = style({
  minInlineSize: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const FoldCue = style({
  marginInlineStart: 'auto',
  flexShrink: 0,
  opacity: config.opacity.P300,
  transition: transition(['opacity'], motion.duration.Fast),
});

globalStyle(`${ColumnHeader}:hover ${FoldCue}, ${ColumnHeader}:focus-visible ${FoldCue}`, {
  opacity: config.opacity.P500,
});

// 90° collapsed rail label reading upward (−90°); vertical-rl + rotate(180deg) works in Chromium + WebKit.
export const RailLabel = style({
  writingMode: 'vertical-rl',
  transform: 'rotate(180deg)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minBlockSize: 0,
  flex: '0 1 auto',
  letterSpacing: '0.01em',
});

export const UnreadDot = style({
  display: 'inline-block',
  inlineSize: toRem(7),
  blockSize: toRem(7),
  borderRadius: '50%',
  backgroundColor: color.Primary.Main,
  flexShrink: 0,
});

export const ColumnBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  flex: '1 1 auto',
  minBlockSize: 0,
  minInlineSize: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: config.space.S200,
  isolation: 'isolate',
});

export const ShowMoreButton = style([
  DefaultReset,
  hoverSurface,
  {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    inlineSize: '100%',
    paddingBlock: config.space.S200,
    paddingInline: config.space.S300,
    borderRadius: config.radii.R300,
    border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
    backgroundColor: color.SurfaceVariant.Container,
    color: color.SurfaceVariant.OnContainer,
    cursor: 'pointer',
    transition: transition(['background-color'], motion.duration.Normal),
    selectors: { '&:focus-visible': focusRing },
  },
]);
