import { style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { motion } from '../ui/styles/Motion.css';
import { controlsTopInset, footerInset } from '../ui/styles/RoomOverlay.css';
import { transition } from '../ui/styles/transition';

/**
 * Left-edge conversation minimap ported from the t3code timeline. The rail
 * hit area is intentionally narrower than the reference (14px instead of
 * 40px) so it never covers message avatars — this fork's timeline has no
 * empty side gutter to float over.
 */
export const MinimapContainer = style({
  position: 'absolute',
  top: controlsTopInset,
  // Anchor above the composer so transient dock bars (typing, read receipts, jobs, approvals)
  // do not shift the centered rail vertically, falling back to `footerInset` when unset.
  bottom: `var(--room-composer-height, ${footerInset})`,
  insetInlineStart: 0,
  width: toRem(72),
  zIndex: 3,
  display: 'none',
  pointerEvents: 'none',
  '@media': {
    '(pointer: fine)': {
      display: 'block',
    },
  },
});

export const MinimapBody = style({
  position: 'relative',
  height: '100%',
  width: '100%',
  userSelect: 'none',
});

export const MinimapRail = style({
  pointerEvents: 'auto',
  position: 'absolute',
  top: '50%',
  insetInlineStart: 0,
  transform: 'translateY(-50%)',
  width: toRem(14),
  cursor: 'pointer',
  touchAction: 'none',
  background: 'none',
  border: 'none',
  padding: 0,
  selectors: {
    '&:focus-visible': {
      outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
      outlineOffset: toRem(2),
    },
  },
});

const EXPANDED_RAIL = `${MinimapRail}[data-expanded="true"]`;

const MinimapStripBase = style({
  pointerEvents: 'none',
  position: 'absolute',
  insetInlineStart: 0,
  height: toRem(1.5),
  transform: 'translateY(-50%)',
  borderRadius: config.radii.Pill,
  backgroundColor: color.SurfaceVariant.OnContainer,
  opacity: 0.28,
  transition: transition(
    ['background-color', 'width', 'height', 'opacity'],
    motion.duration.Normal
  ),
  selectors: {
    '&[data-in-view="true"]': {
      backgroundColor: color.Surface.OnContainer,
      opacity: 0.78,
    },
    [`${EXPANDED_RAIL} &`]: {
      height: toRem(2),
      opacity: 0.4,
    },
    [`${EXPANDED_RAIL} &[data-in-view="true"]`]: {
      opacity: 0.95,
    },
  },
});

export const MinimapStrip = styleVariants({
  Rest: [
    MinimapStripBase,
    {
      width: toRem(5),
      selectors: {
        '&[data-in-view="true"]': {
          width: toRem(7),
        },
        [`${EXPANDED_RAIL} &`]: {
          width: toRem(8),
        },
      },
    },
  ],
  Near: [
    MinimapStripBase,
    {
      width: toRem(11),
      selectors: {
        [`${EXPANDED_RAIL} &`]: {
          opacity: 0.5,
        },
      },
    },
  ],
  Close: [
    MinimapStripBase,
    {
      width: toRem(16),
      selectors: {
        [`${EXPANDED_RAIL} &`]: {
          opacity: 0.65,
        },
      },
    },
  ],
  Active: [
    MinimapStripBase,
    {
      width: toRem(24),
      selectors: {
        [`${EXPANDED_RAIL} &`]: {
          opacity: 0.92,
        },
        [`${EXPANDED_RAIL} &[data-in-view="true"]`]: {
          opacity: 0.98,
        },
      },
    },
  ],
});

export const MinimapPreviewCard = style({
  pointerEvents: 'none',
  position: 'absolute',
  insetInlineStart: toRem(32),
  width: toRem(320),
  maxWidth: `calc(100vw - ${toRem(96)})`,
  padding: `${toRem(8)} ${toRem(12)}`,
  borderRadius: config.radii.R400,
  border: `solid ${config.borderWidth.B300} ${color.Surface.ContainerLine}`,
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  textAlign: 'start',
  boxShadow: config.shadow.E400,
  zIndex: 1,
});

export const MinimapPreviewMeta = style({
  display: 'block',
  marginBottom: toRem(2),
  color: color.SurfaceVariant.OnContainer,
  fontSize: toRem(11),
  lineHeight: toRem(16),
  fontVariantNumeric: 'tabular-nums',
});

export const MinimapPreviewTitle = style({
  display: 'block',
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: toRem(14),
  lineHeight: toRem(20),
  fontWeight: 500,
});

export const MinimapPreviewBody = style({
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: '3',
  marginTop: toRem(4),
  maxHeight: toRem(60),
  overflow: 'hidden',
  color: color.SurfaceVariant.OnContainer,
  fontSize: toRem(14),
  lineHeight: toRem(20),
});
