import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config } from 'folds';

/** Fades the cards into the background at an edge that has more cards beyond it. */
export const UrlPreviewHolderGradient = recipe({
  base: [
    DefaultReset,
    {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: config.space.S600,
      zIndex: 1,
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







      translate: '0 -50%',
    },
  ],
  variants: {
    position: {
      Left: { insetInlineStart: config.space.S100 },
      Right: { insetInlineEnd: config.space.S100 },
    },
  },
});
