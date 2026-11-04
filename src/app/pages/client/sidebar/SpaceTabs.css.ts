import { globalStyle, style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { color, config, toRem } from 'folds';

/** A rail entry that can be dragged: no text selection or scrolling hijacks the gesture. */
export const SpaceDragSource = style({
  position: 'relative',
  touchAction: 'manipulation',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  outline: 'none',
});

/** The entry being dragged: lifted above its neighbours and dimmed at its old place. */
export const SpaceDragging = style({ zIndex: 2, opacity: 0.6 });

const hintLine = {
  content: '',
  position: 'absolute',
  insetInline: 0,
  marginInline: 'auto',
  inlineSize: toRem(42),
  blockSize: toRem(2),
  borderRadius: config.radii.Pill,
  backgroundColor: color.Primary.Main,
  pointerEvents: 'none',
} as const;

/** Where a dragged space lands: a line above or below an entry, or a ring to group with it. */
export const DropHint = recipe({
  base: { position: 'relative' },
  variants: {
    at: {
      above: { selectors: { '&::after': { ...hintLine, top: `calc(-1 * ${toRem(7)})` } } },
      below: { selectors: { '&::after': { ...hintLine, bottom: `calc(-1 * ${toRem(7)})` } } },
      child: {
        selectors: {
          '&::after': {
            content: '',
            position: 'absolute',
            inset: `calc(-1 * ${toRem(3)})`,
            marginInline: 'auto',
            inlineSize: toRem(48),
            borderRadius: config.radii.R500,
            boxShadow: `0 0 0 ${toRem(2)} ${color.Primary.Main}`,
            pointerEvents: 'none',
          },
        },
      },
    },
  },
});

/** An open folder: its spaces stacked on a tinted strip with the folder button on top. */
export const FolderGroup = style({
  display: 'grid',
  justifyItems: 'center',
  rowGap: config.space.S300,
  padding: `${config.space.S100} 0`,
  width: toRem(50),
  margin: '0 auto',
  backgroundColor: color.Background.ContainerHover,
  borderRadius: config.radii.R500,
});

/** A closed folder's face: up to four of its spaces in a two by two grid. */
export const FolderFace = style({
  display: 'grid',
  gridTemplateColumns: `repeat(2, ${toRem(16)})`,
  gridAutoRows: toRem(16),
  gap: toRem(2),
  padding: toRem(4),
  // The same tint as an open folder's strip.
  backgroundColor: color.Background.ContainerHover,
});

/** One small picture or initial on a folder's face. */
const FACE_TILE = toRem(16);

export const FolderFaceTile = style({
  // The avatar inside fills its nearest positioned box; that must be this tile.
  position: 'relative',
  width: FACE_TILE,
  height: FACE_TILE,
  borderRadius: config.radii.R300,
  overflow: 'hidden',
  fontSize: toRem(9),
  fontWeight: 600,
  lineHeight: FACE_TILE,
  textAlign: 'center',
});

// The avatar, picture or initial, covers the whole tile.
globalStyle(`${FolderFaceTile} > *`, {
  position: 'absolute',
  inset: 0,
  transform: 'none',
  display: 'grid',
  placeItems: 'center',
});
