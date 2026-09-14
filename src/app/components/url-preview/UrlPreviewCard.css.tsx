import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, toRem } from 'folds';

export const UrlPreviewHolderGradient = recipe({
  base: [
    DefaultReset,
    {
      position: 'absolute',
      height: '100%',
      width: toRem(10),
      zIndex: 1,
    },
  ],
  variants: {
    position: {
      Left: {
        insetInlineStart: 0,
        background: `linear-gradient(to right,${color.Surface.Container} , rgba(116,116,116,0))`,
        selectors: { 'html[dir="rtl"] &': { transform: 'scaleX(-1)' } },
      },
      Right: {
        insetInlineEnd: 0,
        background: `linear-gradient(to left,${color.Surface.Container} , rgba(116,116,116,0))`,
        selectors: { 'html[dir="rtl"] &': { transform: 'scaleX(-1)' } },
      },
    },
  },
});
export const UrlPreviewHolderBtn = recipe({
  base: [
    DefaultReset,
    {
      position: 'absolute',
      zIndex: 1,
    },
  ],
  variants: {
    position: {
      Left: {
        insetInlineStart: 0,
        transform: 'translateX(-25%)',
        selectors: { 'html[dir="rtl"] &': { transform: 'translateX(25%)' } },
      },
      Right: {
        insetInlineEnd: 0,
        transform: 'translateX(25%)',
        selectors: { 'html[dir="rtl"] &': { transform: 'translateX(-25%)' } },
      },
    },
  },
});
