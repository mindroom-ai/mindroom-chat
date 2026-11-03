import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';
import { glassSurface } from '../../styles/Glass.css';

// A link preview card: optional image on the left, title, description and site name.
//
// Sizes follow from folds tokens: the text block is a T300 title (1.25rem line), two T200
// description lines (2 x 1.125rem), a B300 site line (1rem) and two S100 gaps (0.5rem), 5rem in
// all, plus S200 padding above and below: 6rem. The image is a square of that height. The card
// is as wide as the paste attachment card beside it in messages (28rem).
const TEXT_BLOCK_HEIGHT = '6rem';
export const UrlPreview = style([
  DefaultReset,
  glassSurface({ level: 'panel', variant: 'SurfaceVariant' }),
  {
    width: '28rem',
    maxWidth: '100%',
    minHeight: TEXT_BLOCK_HEIGHT,
    display: 'flex',
    alignItems: 'stretch',
    overflow: 'hidden',
    borderRadius: config.radii.R400,
    color: color.SurfaceVariant.OnContainer,
    boxSizing: 'border-box',
  },
]);

export const UrlPreviewImg = style([
  DefaultReset,
  {
    width: TEXT_BLOCK_HEIGHT,
    height: TEXT_BLOCK_HEIGHT,
    flex: 'none',
    objectFit: 'cover',
    // Shown while the image loads and behind transparent images.
    background: color.SurfaceVariant.ContainerActive,
  },
]);

// Fills the rest of the card; `minWidth: 0` lets long titles truncate instead of widening it.
export const UrlPreviewContent = style([
  DefaultReset,
  {
    flex: '1 1 0',
    minInlineSize: 0,
    display: 'flex',
    flexFlow: 'column',
    justifyContent: 'center',
    rowGap: config.space.S100,
    paddingBlock: config.space.S200,
    paddingInline: config.space.S300,
  },
]);

const DESCRIPTION_LINES = 2;

// At most two lines, cut with an ellipsis (the WebKit box clamp is what every engine supports).
export const UrlPreviewDescription = style([
  DefaultReset,
  {
    overflow: 'hidden',
    overflowWrap: 'anywhere',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: DESCRIPTION_LINES,
  },
]);
