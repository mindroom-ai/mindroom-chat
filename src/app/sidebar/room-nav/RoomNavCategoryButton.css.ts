import { style } from '@vanilla-extract/css';
import { touchTarget } from '../../ui/styles/touchTarget';

/**
 * Collapsible sidebar category button. Keeps base layout in CSS so callers (such as compact space
 * headers with overlaid hover actions) can override inline-end padding cleanly.
 *
 * Touch hit area: 44 px wide, and as tall as the rows allow. An open category's first row stands
 * 4 px below the heading, so the area reaches 2 px past it; a closed one has 12 px or more around
 * it and reaches its full 44 px.
 */
export const CategoryButton = style([
  touchTarget('22px', '', { blockReach: '2px' }),
  touchTarget('22px', '[aria-expanded="false"]'),
  {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    background: 'none',
    border: 0,
    padding: '4px',
    color: 'inherit',
    cursor: 'pointer',
    textAlign: 'start',
    flexGrow: 1,
    minWidth: 0,
  },
]);
