import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';

// The viewer fills its modal: the header bar on top, the zoomable image area below.
export const ImageViewer = style([
  DefaultReset,
  {
    inlineSize: '100%',
    blockSize: '100%',






  DefaultReset,
  {
    paddingInline: config.space.S200,
    gap: config.space.S200,
    flexShrink: 0,
    borderBlockEnd: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  },
]);

// Pointer gestures pan the image here, so the browser must not scroll or zoom the page.







    minHeight: 0,
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
