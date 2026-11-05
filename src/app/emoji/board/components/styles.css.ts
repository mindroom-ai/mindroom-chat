import { type StyleRule, style } from '@vanilla-extract/css';
import { DefaultReset, FocusOutline, color, config, toRem } from 'folds';
import { glassFloating, glassSurface } from '../../../ui/styles/Glass.css';

// Emoji and sticker picker: a content column (search, groups, preview) beside a group rail.
//
// Sizes: an emoji cell is 2.75rem (44 px), the smallest comfortable touch target, as the voice
// player's controls use. Eight cells and S200 padding on both sides make the content 23rem; the
// rail holds folds IconButton size 300 (2rem) with S200 on both sides, 3rem. The board is
// 26rem square, which fits the search field, six rows with their group label, and the preview.
const CELL = 2.75;
const RAIL_WIDTH = `${2 + 2 * 0.5}rem`;
const BOARD_SIZE = `${8 * CELL + 2 * 0.5 + 3}rem`;

/** A box of the same length on both sides. */
const square = (length: string) => ({ width: length, height: length });

/** A glyph or image centered in its box. */
const centered: StyleRule = { display: 'inline-grid', placeItems: 'center' };

/** An image scaled to fit a square of `px` pixels without cropping. */
const fitted = (px: number): StyleRule => ({ ...square(toRem(px)), objectFit: 'contain' });

const verticalStack: StyleRule = { display: 'flex', flexDirection: 'column' };

export const Base = style([
  DefaultReset,
  glassSurface({ level: 'overlay', variant: 'Surface' }),
  glassFloating,
  {
    color: color.Surface.OnContainer,
    borderRadius: config.radii.R400,
    overflow: 'hidden',
    display: 'flex',
    maxWidth: BOARD_SIZE,
    maxHeight: `calc(100vh - 2 * ${config.space.S400})`,
    width: `calc(100vw - 2 * ${config.space.S400})`,
    height: BOARD_SIZE,
  },
]);

// The group rail at the inline end: group buttons scroll, the add button stays at the bottom.
export const Sidebar = style([
  DefaultReset,
  verticalStack,
  {
    width: RAIL_WIDTH,
    flexShrink: 0,
    borderInlineStart: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  },
]);

export const SidebarContent = style({
  flexGrow: 1,
  minHeight: 0,
  overflowY: 'auto',
  scrollbarWidth: 'none',
});

export const SidebarStack = style([
  verticalStack,
  {
    alignItems: 'center',
    rowGap: config.space.S100,
    paddingBlock: config.space.S200,
  },
]);

// A pack's avatar inside a rail button, the size of the icons beside it.
export const SidebarBtnImg = style(fitted(20));

export const SidebarDivider = style({
  inlineSize: toRem(24),
  blockSize: config.borderWidth.B300,
  marginBlockEnd: config.space.S100,
  backgroundColor: color.SurfaceVariant.ContainerLine,
});

// Tab chips over the search field.
export const Header = style({
  flex: 'none',
  flexDirection: 'column',
  rowGap: config.space.S200,
  padding: config.space.S200,
});

export const EmojiGroup = style({
  paddingInline: config.space.S200,
  paddingBottom: config.space.S200,
});

export const EmojiGroupLabel = style({
  display: 'block',
  padding: `${config.space.S100} ${config.space.S300}`,
  color: color.Surface.OnContainer,
  opacity: config.opacity.P500,
});

// Cells wrap eight to a row; stickers take bigger cells in the same flow.
export const EmojiGroupContent = style({
  display: 'flex',
  flexWrap: 'wrap',
});

const hoverFill: StyleRule = { backgroundColor: color.SurfaceVariant.ContainerHover };

// What emoji and sticker buttons share: a centered glyph or image on a hoverable tile.
const item: StyleRule = {
  ...centered,
  padding: 0,
  background: 'none',
  border: 0,
  borderRadius: config.radii.R400,
  cursor: 'pointer',
  ':hover': hoverFill,
  ':focus-visible': hoverFill,
  ':active': { backgroundColor: color.SurfaceVariant.ContainerActive },
};

export const EmojiItem = style([
  DefaultReset,
  FocusOutline,
  item,
  {
    ...square(`${CELL}rem`),
    // folds heading size H2 (1.5625rem), leaving about 0.6rem of the cell around the glyph.
    fontSize: config.fontSize.H2,
    lineHeight: 1,
  },
]);

// Four stickers to a row: the 80 px image and S100 around it.
export const StickerItem = style([DefaultReset, FocusOutline, item, square(toRem(88))]);

export const CustomEmojiImg = style(fitted(28));

export const StickerImg = style(fitted(80));

// The hovered item, large, with its shortcode.
export const Preview = style({
  flex: 'none',
  alignItems: 'center',
  columnGap: config.space.S200,
  paddingInline: config.space.S300,
  minHeight: toRem(52),
  borderTop: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
});

export const PreviewEmoji = style({
  fontSize: toRem(32),
  lineHeight: 1,
  width: toRem(36),
  textAlign: 'center',
});

export const PreviewImg = style(fitted(36));

export const AddCustomEmoji = style([
  DefaultReset,
  verticalStack,
  {
    flex: 'auto',
    gap: config.space.S400,
    padding: config.space.S400,
    overflowY: 'auto',
  },
]);

export const AddCustomEmojiPreview = style([
  fitted(64),
  { flexShrink: 0, borderRadius: config.radii.R300 },
]);
