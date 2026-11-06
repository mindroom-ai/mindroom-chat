import { style } from '@vanilla-extract/css';
import { touchTarget } from '../ui/styles/touchTarget';

/** To a finger the 24 px chip is 44 px wide and reaches 5 px up and down, short of its neighbours. */
export const MarkReadChip = style(touchTarget('22px', '', { blockReach: '5px' }));
