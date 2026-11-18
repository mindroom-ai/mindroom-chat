import { globalStyle, style } from '@vanilla-extract/css';
import { config } from 'folds';

export const Marker = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
});

// The icon keeps its size when the line beside it is cut short.
globalStyle(`${Marker} > svg`, { flexShrink: 0 });

export const Note = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
});

// Beside other markers (a run row in the thread timeline), the line keeps to one line and its
// note, at its end, ends in an ellipsis.
export const Label = style({
  selectors: {
    '[data-quiet-marker-run] &': {
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
  },
});
