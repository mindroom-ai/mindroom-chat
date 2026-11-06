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

// Only the value shrinks: the sentence's words and the sender's name keep their width, and a
// name cut by even a fraction of a pixel would show an ellipsis.
globalStyle(`${OneLine} > bdi`, {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
