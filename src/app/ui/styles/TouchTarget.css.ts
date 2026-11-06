import { style } from '@vanilla-extract/css';
import { touchTarget } from './touchTarget';

/**
 * A 44 px hit area on a touch screen for a control with no other control within 22 px, so the
 * area may reach out all the way; a 40 px header button needs only 4 px to the next.
 */
export const LoneTouchTarget = style(touchTarget('22px'));
