import { style } from '@vanilla-extract/css';
import { touchTarget } from '../../ui/styles/touchTarget';

/**
 * A finger's hit area: 44 px wide, and as tall as the rows allow. An open category's first row
 * stands 4 px below the heading, so the area reaches 2 px past it; a closed one has 12 px or more
 * around it and reaches its full 44 px.
 */
export const CategoryButton = style([
  touchTarget('22px', '', { blockReach: '2px' }),
  touchTarget('22px', '[aria-expanded="false"]'),
]);
