import { style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

/**
 * Left-edge conversation minimap ported from the t3code timeline. The rail
 * hit area is intentionally narrower than the reference (16px instead of
 * 40px) so it never covers message avatars — this fork's timeline has no
 * empty side gutter to float over.
 */
export const MinimapContainer = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
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
  left: 0,
  width: toRem(16),
  transform: 'translateY(-50%)',
  cursor: 'pointer',
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

export const MinimapRailLine = style({
  position: 'absolute',
  top: 0,
  left: toRem(8),
  height: '100%',
  width: toRem(1),
  backgroundColor: color.Surface.ContainerLine,
  opacity: 0.4,
});

const MinimapStripBase = style({
  pointerEvents: 'none',
  position: 'absolute',
  left: 0,
  height: toRem(2),
  transform: 'translateY(-50%)',
  borderRadius: config.radii.Pill,
  backgroundColor: color.SurfaceVariant.OnContainer,
  opacity: 0.35,
  transition: 'background-color 150ms, width 150ms, opacity 150ms',
  selectors: {
    '&[data-in-view="true"]': {
      backgroundColor: color.Surface.OnContainer,
      opacity: 0.9,
    },
  },
});

export const MinimapStrip = styleVariants({
  Rest: [MinimapStripBase, { width: toRem(8) }],
  Near: [MinimapStripBase, { width: toRem(10) }],
  Close: [MinimapStripBase, { width: toRem(16) }],
  Active: [
    MinimapStripBase,
    {
      width: toRem(24),
      opacity: 0.75,
    },
  ],
});

export const MinimapPreviewCard = style({
  pointerEvents: 'none',
  position: 'absolute',
  left: toRem(32),
  width: toRem(320),
  maxWidth: `calc(100vw - ${toRem(96)})`,
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  backgroundColor: color.Surface.Container,
  color: color.Surface.OnContainer,
  padding: config.space.S300,
  textAlign: 'left',
  boxShadow: config.shadow.E400,
  zIndex: 1,
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
  WebkitLineClamp: 3,
  marginTop: toRem(4),
  maxHeight: toRem(60),
  overflow: 'hidden',
  color: color.SurfaceVariant.OnContainer,
  fontSize: toRem(14),
  lineHeight: toRem(20),
});
