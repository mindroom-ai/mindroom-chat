import { globalStyle, style } from '@vanilla-extract/css';

/**
 * A name or topic row's sentence on one line. The quoted value shrinks and is cut with an
 * ellipsis at its own end, so the words around it, and the value's start in either direction,
 * stay in view. `pre` keeps the spaces at the edges of the sentence's parts, which a flex
 * container would otherwise trim from each part.
 */
export const OneLine = style({
  display: 'flex',
  alignItems: 'baseline',
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'pre',
});

globalStyle(`${OneLine} > b, ${OneLine} > bdi`, {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

// The value gives way first; the sender's name is cut only once the value is gone.
globalStyle(`${OneLine} > bdi`, {
  flexShrink: 1000,
});
