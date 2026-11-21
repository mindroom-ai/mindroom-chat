import { style } from '@vanilla-extract/css';
import { touchTarget } from '../ui/styles/touchTarget';

/** A 40 px header button with 4 px between its neighbours: a 44 px target for a finger. */
export const Trigger = style(touchTarget('2px'));
