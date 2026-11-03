import { style } from '@vanilla-extract/css';
import { DefaultReset, FocusOutline, color, config, toRem } from 'folds';
import { glassFloating, glassSurface } from '../../../styles/Glass.css';

// Emoji and sticker picker: a content column (search, groups, preview) beside a group rail.
//
// Sizes: an emoji cell is 2.75rem (44 px), the smallest comfortable touch target, as the voice
// player's controls use. Eight cells and S200 padding on both sides make the content 23rem; the
// rail holds folds IconButton size 300 (2rem) with S200 on both sides, 3rem. The board is
// 26rem square, which fits the search field, six rows with their group label, and the preview.
const CELL = 2.75;
const RAIL_WIDTH = `${2 + 2 * 0.5}rem`;
const BOARD_SIZE = `${8 * CELL + 2 * 0.5 + 3}rem`;

export const Base = style([
  DefaultReset,
  glassSurface({ level: 'overlay', variant: 'Surface' }),
  glassFloating,
  {
    maxWidth: BOARD_SIZE,
    width: `calc(100vw - 2 * ${config.space.S400})`,
    height: BOARD_SIZE,
    maxHeight: `calc(100vh - 2 * ${config.space.S400})`,
    display: 'flex',
    overflow: 'hidden',






  DefaultReset,
  {
    width: RAIL_WIDTH,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
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
    width: `${CELL}rem`,
    height: `${CELL}rem`,
    // folds heading size H2 (1.5625rem), leaving about 0.6rem of the cell around the glyph.
    fontSize: config.fontSize.H2,
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
