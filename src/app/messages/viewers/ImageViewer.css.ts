import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';

const surfacePaint = { color: color.Surface.OnContainer, background: color.Surface.Container };
const centeredFlex = { display: 'flex', alignItems: 'center', justifyContent: 'center' } as const;

// The viewer fills its modal: the header bar on top, the zoomable image area below.
export const ImageViewer = style([
  DefaultReset,
  surfacePaint,
  { inlineSize: '100%', blockSize: '100%' },
]);

export const ImageViewerHeader = style([
  DefaultReset,
  {
    paddingInline: config.space.S200,
    gap: config.space.S200,
    flexShrink: 0,
    borderBlockEnd: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  },
]);

// Pointer gestures pan the image here, so the browser must not scroll or zoom the page.
export const ImageViewerContent = style([
  DefaultReset,
  centeredFlex,
  {
    flexGrow: 1,
    minWidth: 0,
    overflow: 'hidden',
    backgroundColor: color.SurfaceVariant.Container,
    touchAction: 'none',
  },
]);

// Fits inside the area at 100% zoom; zoom and pan only change its transform.
export const ImageViewerImg = style([
  DefaultReset,
  {
    maxInlineSize: '100%',
    maxBlockSize: '100%',
    objectFit: 'contain',
    userSelect: 'none',
    transition: 'transform 100ms ease-out',
    selectors: {
      '&[data-gesture="true"]': {
        transition: 'none',
      },
    },
  },
]);

// Holds the image area and, over its middle edges, the arrows to the previous and next picture.
export const ImageViewerStage = style([
  DefaultReset,
  {
    position: 'relative',
    display: 'flex',
    flexGrow: 1,
    minHeight: 0,
  },
]);

export const ImageViewerStep = style({
  position: 'absolute',
  insetBlockStart: '50%',
  transform: 'translateY(-50%)',
  selectors: {
    '&[data-edge="start"]': { insetInlineStart: config.space.S200 },
    '&[data-edge="end"]': { insetInlineEnd: config.space.S200 },
    '&[aria-disabled="true"]': { opacity: 0.4, cursor: 'default' },
  },
});
