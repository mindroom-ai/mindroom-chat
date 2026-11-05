import { style } from '@vanilla-extract/css';
import { DefaultReset } from 'folds';

/** The topic line under a room's name: a plain button that opens the whole topic. */
export const HeaderTopic = style([
  DefaultReset,
  {
    display: 'flex',
    minWidth: 0,
    maxWidth: '100%',
    padding: 0,
    border: 0,
    background: 'none',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
    ':focus-visible': { outlineOffset: 2 },
  },
]);
