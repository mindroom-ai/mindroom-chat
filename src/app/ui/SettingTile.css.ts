import { style } from '@vanilla-extract/css';
import { globalTouchTarget } from './styles/touchTarget';

/** A tile's trailing slot. A lone control there (a switch, a picker) is 44 px to a finger. */
export const After = style({});
globalTouchTarget(`${After} > button:only-child`, '22px');
