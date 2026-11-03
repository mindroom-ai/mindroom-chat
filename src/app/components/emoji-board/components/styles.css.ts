import { style } from '@vanilla-extract/css';
import { DefaultReset, FocusOutline, color, config, toRem } from 'folds';
import { glassFloating, glassSurface } from '../../../styles/Glass.css';

// Emoji and sticker picker: a content column (search, groups, preview) beside a group rail.
export const Base = style([
  DefaultReset,
  glassSurface({ level: 'overlay', variant: 'Surface' }),
  glassFloating,
  {



    maxHeight: `calc(100vh - 2 * ${config.space.S400})`,
    display: 'flex',
    overflow: 'hidden',












    borderInlineStart: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,






  minHeight: 0,
  overflowY: 'auto',
  scrollbarWidth: 'none',
});















  backgroundColor: color.SurfaceVariant.ContainerLine,

























  padding: `${config.space.S100} ${config.space.S300}`,









  },
]);

const item = {




  background: 'none',






  DefaultReset,
  FocusOutline,
  item,
  {
    width: toRem(44),
    height: toRem(44),
    fontSize: toRem(28),
    lineHeight: 1,
    selectors: {

















      },
    },
  },
]);

export const CustomEmojiImg = style({



});

export const StickerImg = style({
  width: toRem(80),
  height: toRem(80),








  minHeight: toRem(52),
  borderTop: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
});

export const PreviewEmoji = style({
  fontSize: toRem(32),
  lineHeight: 1,
  width: toRem(36),
  textAlign: 'center',
});

export const PreviewImg = style({



});

export const AddCustomEmoji = style([
  DefaultReset,
  {
    display: 'flex',



  },
]);

export const AddCustomEmojiPreview = style({
  width: toRem(64),
  height: toRem(64),



});
