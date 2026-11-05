import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config } from 'folds';

const FADE_Z_INDEX = 1;

/** Fades the cards into the background at an edge that has more cards beyond it. */
export const UrlPreviewHolderGradient = recipe({
  base: [
    DefaultReset,
    {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: config.space.S600,
      zIndex: FADE_Z_INDEX,
      pointerEvents: 'none',
    },
  ],
  variants: {
    position: {
      Left: {
        insetInlineStart: 0,
        background: `linear-gradient(to right, ${color.Surface.Container}, transparent)`,
      },
      Right: {
        insetInlineEnd: 0,
        background: `linear-gradient(to left, ${color.Surface.Container}, transparent)`,
      },
    },
  },
});

/** The arrow button over an edge, centered vertically on the cards and above the fade. */
export const UrlPreviewHolderBtn = recipe({
  base: [
    DefaultReset,
    {
      position: 'absolute',
      insetBlockStart: '50%',
      translate: '0 -50%',
      zIndex: FADE_Z_INDEX + 1,
    },
  ],
  variants: {
    position: {
      Left: { insetInlineStart: config.space.S100 },
      Right: { insetInlineEnd: config.space.S100 },
    },
  },
});

/** The preview's picture is a button that opens it in the image viewer. */
export const UrlPreviewImageButton = style([
  DefaultReset,
  {
    display: 'flex',
    flex: 'none',
    padding: 0,
    border: 'none',
    background: 'none',
    cursor: 'zoom-in',
    selectors: {
      '&:focus-visible': {
        outline: `${config.borderWidth.B600} solid ${color.Primary.Main}`,
        outlineOffset: `calc(-1 * ${config.borderWidth.B600})`,
      },
    },
  },
]);
