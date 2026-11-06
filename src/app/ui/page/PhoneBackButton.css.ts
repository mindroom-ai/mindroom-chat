import { style } from '@vanilla-extract/css';
import { touchTarget } from '../styles/touchTarget';

/** The back chevron's 44 px square takes taps in its rounded corners too. */
export const BackTarget = style(touchTarget('2px'));
