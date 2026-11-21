import { style } from '@vanilla-extract/css';
import { toRem } from 'folds';
import { touchTarget } from './styles/touchTarget';

/**
 * A floating pill (Jump to Latest, Jump to Unread, Mark as Read): 44 px tall to a finger. A label
 * longer than the whole float (Bengali's Mark as Read on a phone) breaks into a second line, and
 * the pill grows with it instead of letting the words spill out.
 */
export const FloatingActionStyle = style([
  touchTarget('4px'),
  {
    minWidth: 0,
    maxWidth: '100%',
    selectors: {
      '&&': { height: 'auto', minHeight: toRem(24), paddingBlock: toRem(2) },
    },
  },
]);
