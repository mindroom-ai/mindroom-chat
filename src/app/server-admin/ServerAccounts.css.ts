import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

/**
 * A row of the list, which opens its account: a plain button that keeps the browser's focus ring
 * and the padding the settings pages give every row of a card, and tints under a pointer.
 */
export const AccountRow = style({
  width: '100%',
  border: 'none',
  borderRadius: config.radii.R300,
  background: 'none',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'start',
  cursor: 'pointer',
  // A touch screen keeps :hover on the row tapped last; only a pointer that can hover tints it.
  '@media': {
    '(hover: hover)': {
      selectors: { '&:hover': { backgroundColor: color.SurfaceVariant.ContainerHover } },
    },
  },
});
