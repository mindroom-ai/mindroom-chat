import { style } from '@vanilla-extract/css';
import { shortViewport } from '../styles/shortViewport';

/**
 * The rail's part above its foot group, which scrolls on its own. A phone in landscape (the short
 * viewport that compacts the room chrome too) leaves the rail too short to keep the foot group
 * (Activity, the account, the panel toggle, about 200 px) in place and show the spaces above it, so
 * there the whole rail scrolls as one column and this part keeps its full height.
 */
export const SidebarScrollPart = style({
  minBlockSize: 0,
  '@media': { [shortViewport]: { flexShrink: 0 } },
});
