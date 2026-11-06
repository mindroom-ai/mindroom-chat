import { style } from '@vanilla-extract/css';
import { DefaultReset } from 'folds';
import { touchTarget } from '../ui/styles/touchTarget';

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
  // Its 18 px line grows to 44 px for a finger, over the name above it.
  touchTarget('22px'),
]);

/** A header button, 40 px with 4 px between them: 44 by 44 px to a finger. */
export const HeaderActionButton = style(touchTarget('2px'));
